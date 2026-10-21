# MCP Redis Java decoding implementation plan

> Execute inline using `superpowers:executing-plans`, with test-first changes.

**Goal:** Let MCP clients read Java serialized Redis values without interpreting binary dumps.

**Spec:** https://github.com/t8y2/dbx/issues/12922 (the issue explicitly permits an initial Java-only implementation).

**Architecture:** Add a bounded, data-only Java serialization parser in `dbx-formats`. MCP reverses the driver's lossless Redis display escaping and applies the parser only when `decode` is supplied. Successful values become `{ "codec": "java-serialized", "value": ... }`; unsuccessful values remain byte-for-byte unchanged. Default output and all existing authorization paths remain unchanged.

**Tech stack:** Rust, serde_json, rmcp/schemars; existing TypeScript desktop codec as the compatibility reference.

## Constraints

- `dbx_execute_redis_command` gains optional `decode: "auto" | "java-serialized"`.
- Auto detection requires `AC ED 00 05` and a completely parsed stream.
- Preserve `$class`, `$id`, `$ref`, `$extends`, Java long strings, block data and common collection post-processing conventions used by the desktop.
- Do not instantiate Java classes or execute deserialization hooks.
- Bound input bytes, recursive depth, nodes and normalized output work (including a shared per-reply budget); malformed/unsupported streams fall back to the original display.
- Msgpack, Pickle, PHP Serialize, Protobuf and replacing the desktop codec are outside this initial PR.

## Task 1: Shared Java serialization decoder

Files: `crates/dbx-formats/src/redis_java.rs`, `crates/dbx-formats/src/lib.rs`, `crates/dbx-formats/tests/redis_java.rs`, shared fixture JSON.

- [x] Add real Java ObjectOutputStream fixtures and literal expected JSON, including references, inheritance, maps, arrays, Unicode, enums and longs.
- [x] Run `cargo test -p dbx-formats --test redis_java`; observe missing decoder failure.
- [x] Implement `pub fn decode_java_serialized(bytes: &[u8]) -> Option<serde_json::Value>` with a handle arena and separate normalization pass so cycles stay references.
- [x] Verify malformed/truncated streams, invalid references, negative/oversized lengths and deep nesting all return `None`.
- [x] Run the decoder and existing formats tests.

## Task 2: MCP opt-in output integration

Files: `crates/dbx-mcp/src/redis_decode.rs`, `crates/dbx-mcp/src/server.rs`, `crates/dbx-mcp/src/lib.rs`, `crates/dbx-mcp/Cargo.toml`, `Cargo.lock`.

- [x] Add tests for default request compatibility, schema enum, escaped backslashes, nested command replies and raw fallback.
- [x] Add `RedisDecode` enum and `decode` optional request field with a concrete string schema (no nullable type union).
- [x] Decode individual string leaves after execution, then use existing command/safety output formatting. Never revisit newly decoded JSON as Redis display text.
- [x] Run MCP library and protocol tests, including existing access-policy tests.
- [x] Run the ignored live test against an ephemeral Redis 8.6.3 process, including all shared fixtures, mixed MGET, default raw output and a 21 KB value.

## Task 3: Compatibility, documentation and delivery

Files: `packages/app-tests/redisJavaCodec.test.ts`, shared fixture JSON, `crates/dbx-mcp/tests/live_redis_decode.rs`, English/Chinese MCP documentation.

- [x] Run the desktop parser against the same fixture JSON to prove matching normalized output.
- [x] Document opt-in arguments, success envelope, original-text fallback and Java-only scope.
- [x] Run targeted formatting and `git diff --check`; review bounded parsing, unchanged defaults and permission checks.
Delivery after verification: commit, push to `caichangqing1120/dbx:codex/issue-12922-redis-decode`, and open a PR against `t8y2/dbx:main`, linking #12922 and reporting actual checks.

## Acceptance examples

```json
{"connection_id":"redis","command":"GET cache","decode":"auto"}
```

A stream `aced0005740008736f6d6574657874` produces
`{ "codec": "java-serialized", "value": "sometext" }`. Without `decode`, its
original display remains `\xac\xed\x00\x05t\x00\x08sometext`. A stream with only
`aced0005` remains raw even when decoding is requested.

The parser and MCP integration share remaining work using
`decode_java_serialized_with_budget(bytes: &[u8], remaining: &mut usize)`.
Each input is limited to 1 MiB, 32,768 nodes, depth 64, and 4 MiB of work;
the command reply shares 16 MiB of work including display unescaping. Failed
attempts debit the shared budget. Long field-type references are charged before
copying, and incomplete/cyclic descriptors and unrepresentable UTF-16 surrogate
values return raw fallback.

## Self-review

The three tasks cover opt-in decoding, structured Java values, default compatibility, raw fallback and reuse in a shared Rust crate. No UI behavior or external database mutation is required. Tests compare production parser output with independent Java fixtures and the existing desktop parser.


## Verified results

- `cargo test -p dbx-formats --locked --offline`: 115 library tests and 7 decoder integration tests passed.
- `RUST_MIN_STACK=8388608 cargo test -p dbx-mcp --no-default-features --features sqlite-bundled --lib --test protocol --test live_redis_decode --locked --offline`: 205 library tests and 14 protocol tests passed; the opt-in live test was ignored by this default invocation.
- `RUST_MIN_STACK=8388608 cargo test -p dbx-mcp --no-default-features --features sqlite-bundled --test live_redis_decode --locked --offline -- --ignored --nocapture`: 1 real Redis/MCP transport test passed; the task-owned Redis process was stopped.
- `pnpm exec vitest run packages/app-tests/redisJavaCodec.test.ts packages/app-tests/redisValuePresentation.test.ts apps/desktop/src/lib/redis/codec/__tests__`: 82 tests across 8 files passed.
- `cargo fmt -p dbx-formats -p dbx-mcp -- --check`, targeted `oxfmt --check`, and `git diff --check` passed.
- Independent read-only review approved the final decoder/integration after resource-bound and malformed-stream findings were addressed.

Rust builds used disabled development/test debug info and incremental compilation to reduce local build output. The no-default-features build emits existing unused/dead-code warnings from unchanged `dbx-core` files. The full desktop/workspace build was not run.
