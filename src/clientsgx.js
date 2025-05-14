/// This is the js client for the balance checker demo in the c++ SGX code.
// const crypto = require('crypto');
// const fetch = require('node-fetch');

// Constants
const IV_SIZE = 12; // AES-GCM IV size

// Utility functions for Base64 encoding/decoding
const base64Encode = (bytes) => {
    // Convert the Uint8Array to a binary string
    let binaryString = '';
    for (let i = 0; i < bytes.length; i++) {
        binaryString += String.fromCharCode(bytes[i]);
    }

    // Convert the binary string to a Base64 string
    let base64String = btoa(binaryString);

    return base64String;
}
const base64Decode = (str) => {
    let binaryString = atob(str);

    // Create a Uint8Array from the binary string
    let uint8Array = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        uint8Array[i] = binaryString.charCodeAt(i);
    }

    return uint8Array;
}

const HEX_STRINGS = "0123456789abcdef";
const MAP_HEX = {
    0: 0, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6,
    7: 7, 8: 8, 9: 9, a: 10, b: 11, c: 12, d: 13,
    e: 14, f: 15, A: 10, B: 11, C: 12, D: 13,
    E: 14, F: 15
};

// Fast Uint8Array to hex
function toHex(bytes) {
    return Array.from(bytes || [])
        .map((b) => HEX_STRINGS[b >> 4] + HEX_STRINGS[b & 15])
        .join("");
}

// Mimics Buffer.from(x, 'hex') logic
// Stops on first non-hex string and returns
// https://github.com/nodejs/node/blob/v14.18.1/src/string_bytes.cc#L246-L261
function fromHex(hexString) {
    const bytes = new Uint8Array(Math.floor((hexString || "").length / 2));
    let i;
    for (i = 0; i < bytes.length; i++) {
        const a = MAP_HEX[hexString[i * 2]];
        const b = MAP_HEX[hexString[i * 2 + 1]];
        if (a === undefined || b === undefined) {
            break;
        }
        bytes[i] = (a << 4) | b;
    }
    return i === bytes.length ? bytes : bytes.slice(0, i);
}

function concatUint8Arrays(...arrays) {
    // Concatenate the arrays into a single array
    let concatenatedArray = arrays.reduce((acc, arr) => acc.concat(Array.from(arr)), []);

    // Create a new Uint8Array from the concatenated array
    return new Uint8Array(concatenatedArray);
}


async function deriveECDHKey(publicKey) {
    console.log("Derive Key");
    // Generate an ECDH key pair
    const keyPair = await window.crypto.subtle.generateKey(
        {
            name: "ECDH",
            namedCurve: "P-256"
        },
        true,
        ["deriveKey"]
    );

    // Import the other party's public key
    const importedPublicKey = await window.crypto.subtle.importKey(
        "raw",
        publicKey,
        {
            name: "ECDH",
            namedCurve: "P-256"
        },
        true,
        []
    );

    // Derive the shared secret
    const sharedSecret = await window.crypto.subtle.deriveKey(
        {
            name: "ECDH",
            public: importedPublicKey
        },
        keyPair.privateKey,
        {
            name: "AES-GCM",
            length: 256
        },
        true,
        ["encrypt", "decrypt"]
    );
    const sharedSecretBytes = new Uint8Array(await window.crypto.subtle.exportKey("raw", sharedSecret));
    // Export the public key
    const exportedPublicKey = new Uint8Array(await window.crypto.subtle.exportKey(
        "raw",
        keyPair.publicKey
    ));
    return [sharedSecretBytes, exportedPublicKey];
}


// Encrypt a message
// function encrypt(message, key, iv) {
//     const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
//     cipher.setAutoPadding(false);
//     const encrypted = Buffer.concat([cipher.update(message), cipher.final()]);
//     return {
//         encryptedData: encrypted,
//         authTag: cipher.getAuthTag()
//     };
// }
async function encrypt(message, keyBytes, iv) {
    // const encodedMessage = new TextEncoder().encode(message);
    const key = await window.crypto.subtle.importKey("raw", keyBytes, "AES-GCM", true, ["encrypt", "decrypt"]);
    const encrypted = await window.crypto.subtle.encrypt(
        {
            name: "AES-GCM",
            iv: iv,
            tagLength: 128
        },
        key,
        message
    );

    return new Uint8Array(encrypted);
}

// Decrypt a message
// function decrypt(encrypted, key, iv, authTag) {
//     const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
//     decipher.setAutoPadding(true);
//     decipher.setAuthTag(authTag);
//     const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
//     return decrypted;
// }
async function decrypt(encrypted, keyBytes, iv, authTag) {
    const key = await window.crypto.subtle.importKey("raw", keyBytes, "AES-GCM", true, ["encrypt", "decrypt"]);
    const decrypted = await window.crypto.subtle.decrypt(
        {
            name: "AES-GCM",
            iv: iv,
            tagLength: 128
        },
        key,
        concatUint8Arrays(encrypted, authTag)
    );

    return new Uint8Array(decrypted);
}

function getRandomBytes(size) {
    const array = new Uint8Array(size);
    window.crypto.getRandomValues(array);
    return array;
}

// example balance checker client
const CheckBalance = async function (addr) {
    const host = "https://obliviouslabs.eastus.cloudapp.azure.com";
    try {
        // For the demo, we omit PKI and attestations
        const res = await fetch(`${host}/public_key`);
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);

        const serverPubKeyBase64 = await res.text();
        console.log("Server Public Key: ", serverPubKeyBase64);
        // const serverPubKeyBase64 = serverPubkeyHardcoded;
        const serverPubKeyBytes = base64Decode(serverPubKeyBase64);

        // // print the first 32 bytes in hex
        // const [sharedSecret, clientPublicKey] = deriveKey(Buffer.concat([Buffer.from([0x04]), serverPubKeyBytes]));
        const [sharedSecret, clientPubKeyBytes] = await deriveECDHKey(concatUint8Arrays(new Uint8Array([0x04]), serverPubKeyBytes));


        const nonce = getRandomBytes(4)
        const body = await makeBalanceQueryBody('USDT', addr, nonce, clientPubKeyBytes, sharedSecret);

        const postRes = await fetch(`${host}/secure`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/octet-stream',
            },
            body: body,
        });


        const encryptedResponse = await postRes.text();

        const { balance, lastBlock, successFlag, queryTime } = await decodeResponse(encryptedResponse, nonce, sharedSecret);
        console.log("Balance:", balance);
        console.log("Last Block:", lastBlock);
        console.log("Success Flag:", successFlag);
        console.log("Query Time:", queryTime);
        return { balance, lastBlock, successFlag };

    } catch (error) {
        console.error("Error:", error);
    }

    async function makeBalanceQueryBody(coinType, addr, nonce, clientPubKey, sharedSecret) {
        // hex to bytes
        if (addr.length !== 42 || !addr.startsWith("0x")) {
            throw new Error("Invalid address format");
        }
        const addrBytes = fromHex(addr.slice(2));
        const READ_BALANCE = new Uint8Array([0x00, 0x00, 0x00, 0x00]);
        const USDT = new Uint8Array([0x00, 0x00, 0x00, 0x00]);
        const queryBuf = concatUint8Arrays(READ_BALANCE, USDT, addrBytes, nonce);

        const iv = getRandomBytes(IV_SIZE);
        const encryptedDataAndTag = await encrypt(queryBuf, sharedSecret, iv);
        return base64Encode(concatUint8Arrays(encryptedDataAndTag, clientPubKey.slice(1), iv));
    }

    async function decodeResponse(responseBase64, nonce, sharedSecret) {
        const responseBytes = base64Decode(responseBase64);

        const balanceLen = 32
        const lastBlockLen = 8
        const nonceLen = 4
        const successFlagLen = 4
        const queryTimeLen = 8
        const tagLen = 16
        const ivLen = 12
        const encryptedDataLen = balanceLen + lastBlockLen + nonceLen + successFlagLen + queryTimeLen
        if (responseBytes.length !== (encryptedDataLen + tagLen + ivLen - 1) / 8 * 8 + 1) {
            throw new Error("Invalid encrypted response size, expected 68 bytes, got " + responseBytes.length + " bytes");
        }
        var offset = 0
        const encryptedData = responseBytes.slice(offset, offset + encryptedDataLen); // Assuming first IV_SIZE bytes are IV
        offset += encryptedDataLen
        const authTag = responseBytes.slice(offset, offset + tagLen); // Assuming authTag 
        offset += tagLen
        const iv = responseBytes.slice(offset, offset + ivLen); // Assuming last 12 bytes are IV
        const decryptedResponse = await decrypt(encryptedData, sharedSecret, iv, authTag);
        offset = 0
        const balanceBytes = decryptedResponse.slice(0, balanceLen);
        offset += balanceLen
        const lastBlockBytes = decryptedResponse.slice(offset, offset + lastBlockLen);
        offset += lastBlockLen
        const responseNonce = decryptedResponse.slice(offset, offset + nonceLen);
        offset += nonceLen
        const successFlagBytes = decryptedResponse.slice(offset, offset + successFlagLen);
        offset += successFlagLen
        const queryTimeBytes = decryptedResponse.slice(offset, offset + queryTimeLen);
        for (let i = 0; i < nonce.length; i++) {
            if (nonce[i] !== responseNonce[i]) {
                throw new Error("Invalid nonce in response");
            }
        }
        const balance = BigInt("0x" + toHex(balanceBytes));
        const lastBlock = BigInt("0x" + toHex(lastBlockBytes));
        const successFlag = BigInt("0x" + toHex(successFlagBytes));
        const queryTime = BigInt("0x" + toHex(queryTimeBytes));
        return { balance, lastBlock, successFlag, queryTime };

    }
}

export default CheckBalance;