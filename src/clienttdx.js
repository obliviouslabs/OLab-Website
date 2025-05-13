// const crypto = require('crypto');
// const fetch = require('node-fetch');
import { getBytes, concat, keccak256, zeroPadValue, getBigInt, formatUnits } from "ethers";

const tdxHost = "https://demo1.pg.xtrm0.com";
const tokenName = "WBTC";
const balances_slot = "0x00";
const CONST_DECIMALS = 8;

// Convert a big integer (u64) into an 8-byte big-endian Uint8Array.
function bigUint64ToBytesBE(value) {
    const bytes = new Uint8Array(8);
    for (let i = 0; i < 8; i++) {
      // Shift right by 8*i, take the lowest byte.
      bytes[7 - i] = Number((value >> BigInt(i * 8)) & BigInt(0xff));
    }
    return bytes;
}

function verify_quote(resp, secure_hash) {
    const body = resp["response"];
    const h = secure_hash(body);
    console.log("Secure Hash: ", h);
    // UNDONE(): verify tappd quote (using dstack libraries)
    return body;
}


function secure_hash_db_state(db_state) {
    // 1) block_id => 8 bytes, big-endian
    const blockId = BigInt(db_state["block_id"]); // safely cast to bigint
    const blockIdBytes = bigUint64ToBytesBE(blockId);

    // 2) The literal separator '|'
    const sep = new TextEncoder().encode("|"); // ASCII => Uint8Array [0x7C]

    // 3) Decode hex strings into bytes using ethers
    
    const stateRootBytes = getBytes(db_state["state_root"]);
    if (stateRootBytes.length !== 32) {
        throw new Error(`state_root must be 32 bytes, got ${stateRootBytes.length}`);
    }

    const addrBytes = getBytes(db_state["contract_address"]);
    if (addrBytes.length !== 20) {
        throw new Error(`contract_address must be 20 bytes, got ${addrBytes.length}`);
    }

    // 4) Concatenate in the exact order: [block_id(8), '|', state_root(32), '|', address(20)]
    const concatenated = concat([blockIdBytes, sep, stateRootBytes, sep, addrBytes]);

    // 5) keccak256 => 32 bytes, returned as a 0x-prefixed hex string
    return keccak256(concatenated);
}

function secure_hash_status_respone(resp) {
    // console.log(ethers.utils);
    // 1) message as UTF-8 bytes
    console.log("Response: ", resp);
    const messageBytes = new TextEncoder().encode(resp["message"]);

    // 2) separator
    const sep = new TextEncoder().encode("|");

    // 3) get the db_state 0x-hash, then decode to raw bytes
    const dbStateHashHex = secure_hash_db_state(resp["db_state"]); // 0x-hex string => 32 bytes
    const dbStateHashBytes = getBytes(dbStateHashHex);
    if (dbStateHashBytes.length !== 32) {
        throw new Error(`db_state secure hash must be 32 bytes, got ${dbStateHashBytes.length}`);
    }

    // 4) concatenate: [message(UTF8), '|', dbStateHash(32)]
    const finalBytes = concat([messageBytes, sep, dbStateHashBytes]);

    // 5) keccak256 => 32 bytes => 0x-hex
    return keccak256(finalBytes);
}

function secure_hash_query_response(resp) {
  // Get secure hash for db_state (a 0x-hex string, 32 bytes)
  const dbStateHashHex = secure_hash_db_state(resp.db_state);
  const dbStateHashBytes = getBytes(dbStateHashHex);

  // Prepare an array of Uint8Arrays starting with the db_state hash.
  const parts = [dbStateHashBytes];

  // For each storage result, append addr and value (each 32 bytes)
  for (const res of resp.resps) {
    const addrBytes = getBytes(res.addr);
    const valueBytes = getBytes(res.value);
    if (addrBytes.length !== 32) {
      throw new Error(`StorageResult addr must be 32 bytes, got ${addrBytes.length}`);
    }
    if (valueBytes.length !== 32) {
      throw new Error(`StorageResult value must be 32 bytes, got ${valueBytes.length}`);
    }
    parts.push(addrBytes, valueBytes);
  }

  // Concatenate all bytes and compute keccak256
  const concatenated = concat(parts);
  return keccak256(concatenated);
}

function compute_address_for_account(slot, addr) {    
    // Create a 32-byte hex value for 0 (SLOT_32):
    const SLOT_32 = zeroPadValue(slot, 32); 
    
    // Create a 32-byte hex value for the account (ACCOUNT_32):
    const ACCOUNT_32 = zeroPadValue(addr, 32);

    // Remove the "0x" prefix from both to get the raw hex digits:
    const accountNoPrefix = ACCOUNT_32.slice(2);
    const slotNoPrefix = SLOT_32.slice(2);

    // Concatenate them (as bytes) and re-add the "0x" prefix:
    const KEY = "0x" + accountNoPrefix + slotNoPrefix;
    console.log("KEY:", KEY);

    // Compute the keccak256 hash of the raw bytes represented by KEY:
    return keccak256(KEY);
}

const CheckStatus = async function() {
    let ret;
    try {
        const res = await fetch(`${tdxHost}/quoted/status`);
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
        const body = await res.json();
        console.log("Server Status Response: ", body);
        ret = verify_quote(body, secure_hash_status_respone);
        console.log("Server Status Response: ", ret);
        console.log("Status: ", ret["message"]);
        console.log("block_id: ", ret["db_state"]["block_id"]);
        console.log("state_root: ", ret["db_state"]["state_root"]);
        console.log("contract_address: ", ret["db_state"]["contract_address"]);
    } catch (error) {
        ret = null;
        console.error("Error:", error);
    }

    return ret;
}

// example balance checker client
const CheckBalance = async function (addr) {
    // For the demo, we are omitting attestations of the https certificate,
    // in a real world scenario, it should be done using for instance unstoppable.tls
    try {
        const res = await fetch(`${tdxHost}/quoted/status`);
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);

        let body = await res.json();
        console.log("Server Status Response: ", body);
        const resp = verify_quote(body, secure_hash_status_respone);
        console.log("Server Status Response: ", resp);
        console.log("Status: ", resp["message"]);
        console.log("block_id: ", resp["db_state"]["block_id"]);
        console.log("state_root: ", resp["db_state"]["state_root"]);
        console.log("contract_address: ", resp["db_state"]["contract_address"]);
    } catch (error) {
        console.error("Error:", error);
        return null;
    }

    try {
        console.log("Slot:", balances_slot);
        console.log("Account:", addr);

        const MEM_ADDR = compute_address_for_account(balances_slot, addr);
        console.log("MEM_ADDR:", MEM_ADDR);

        const resp = await fetch(`${tdxHost}/quoted/storage_at`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ "addr": MEM_ADDR }),
        });
        const body = await resp.json();
        let ret = verify_quote(body, secure_hash_query_response);
        if (ret.resps.length !== 1) {
            throw new Error("Expected exactly one response");
        }
        const storageResult = ret.resps[0];
        const res_addr = storageResult.addr;
        const res_value = storageResult.value;  
        console.log("Storage Result: ", storageResult);
        console.log("Address: ", res_addr);
        console.log("Value: ", res_value);
        const res_num = getBigInt(res_value);
        const res_str = formatUnits(res_num, CONST_DECIMALS);
        return {
            addr: res_addr,
            memory_addr: MEM_ADDR,
            balance: res_value,
            balance_float: res_num,
            balance_str: res_str,
            block: ret.db_state.block_id,
            state_root: ret.db_state.state_root,
            contract_address: ret.db_state.contract_address,
        }
    } catch (error) {
        console.error("Error:", error);
        return null;
    }
}

export { CheckBalance, CheckStatus, tdxHost, tokenName };
