default:
  @just --list

install:
  npm ci

build-wasm:
  npm run build:wasm

lint:
  npm run lint

fmt-check:
  npm run fmt:check

fmt:
  npm run fmt

test:
  npm test

check:
  npm run check

ci:
  npm ci
  npm run build:wasm
  status="$(git status --porcelain -- src/wasm/parser.wasm src/wasm/transform.wasm)"; if [ -n "$status" ]; then echo "$status"; exit 1; fi
  npm run check
