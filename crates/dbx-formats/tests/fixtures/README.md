# Redis Java serialization fixtures

`java/Fixtures.java` generates `ObjectOutputStream` bytes using JDK 21:

```sh
java crates/dbx-formats/tests/fixtures/java/Fixtures.java
```

Each output line contains a fixture name and base64 stream. `redis_java.json`
stores the same bytes as hex and the existing desktop codec's normalized JSON.
The fixtures cover actual Java objects, inheritance, cycles, repeated references,
modified UTF-8, enums, primitive/object arrays, and JDK collections. The JSON
expectations intentionally retain desktop conventions such as string-valued
`long`, annotation block data, collection helper fields, and `$extends`.

Rust tests compare the shared parser against those expectations; the desktop
parity test consumes the same JSON so either implementation's drift is visible.
The generator is only a fixture-authoring aid: Java is not needed to run tests or
to decode values in production.
