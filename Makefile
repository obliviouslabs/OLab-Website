BASEURL ?= "https://www.obliviouslabs.com"

install:
	npm install
	bundle config set --local path vendor/bundle
	bundle install

build:
	node build.js
	bundle exec jekyll build --baseurl "$(BASEURL)"

all: install build
