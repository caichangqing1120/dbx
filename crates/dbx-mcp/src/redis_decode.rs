use dbx_formats::redis_java::decode_java_serialized_with_budget;
use serde_json::{json, Value};

/// The Redis driver escapes all backslashes and emits binary bytes as `\xNN`.
/// Only Java-header candidates are unescaped; literal escape text stays literal.
fn decode_display(display: &str, remaining: &mut usize) -> Option<Value> {
    if !display.starts_with(r"\xac\xed\x00\x05") || display.len() > 4 * 1024 * 1024 {
        return None;
    }
    *remaining = remaining.checked_sub(display.len())?;
    let mut bytes = Vec::new();
    let mut input = display.bytes();
    while let Some(byte) = input.next() {
        if bytes.len() >= 1024 * 1024 {
            return None;
        }
        bytes.push(if byte != b'\\' {
            byte
        } else {
            match input.next()? {
                b'\\' => b'\\',
                b'x' => {
                    let high = (input.next()? as char).to_digit(16)?;
                    let low = (input.next()? as char).to_digit(16)?;
                    (high * 16 + low) as u8
                }
                _ => return None,
            }
        });
    }
    decode_java_serialized_with_budget(&bytes, remaining).map(|value| json!({"codec":"java-serialized","value":value}))
}

pub(crate) fn decode_redis_result(value: &Value) -> Value {
    decode_value(value, &mut (16 * 1024 * 1024))
}

fn decode_value(value: &Value, remaining: &mut usize) -> Value {
    match value {
        Value::String(display) => decode_display(display, remaining).unwrap_or_else(|| value.clone()),
        Value::Array(values) => Value::Array(values.iter().map(|value| decode_value(value, remaining)).collect()),
        Value::Object(values) => {
            values.iter().map(|(key, value)| (key.clone(), decode_value(value, remaining))).collect()
        }
        _ => value.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn decodes_binary_strings_and_preserves_unrecognized_values() {
        let java = r"\xac\xed\x00\x05t\x00\x03a\\b";
        let input = json!([java, "plain text", null, 42, {"field": java}]);
        let decoded = json!({"codec":"java-serialized","value":"a\\b"});
        assert_eq!(decode_redis_result(&input), json!([decoded, "plain text", null, 42, {"field":decoded}]));
    }

    #[test]
    fn malformed_streams_and_literal_escape_text_remain_unchanged() {
        for value in
            [r"\xac\xed\x00\x05", r"\xac\xed\x00\x05t\x00\x05abc", r"\\xac\\xed\\x00\\x05", r"\xac\xed\x00\x05\q"]
        {
            assert_eq!(decode_redis_result(&json!(value)), json!(value));
        }
    }

    #[test]
    fn does_not_decode_a_successful_java_string_twice() {
        let display = r"\xac\xed\x00\x05t\x00\x10\\xac\\xed\\x00\\x05";
        assert_eq!(
            decode_redis_result(&json!(display)),
            json!({"codec":"java-serialized","value":r"\xac\xed\x00\x05"})
        );
    }

    #[test]
    fn matches_the_actual_driver_display_for_shared_java_fixtures() {
        let fixtures: Vec<Value> =
            serde_json::from_str(include_str!("../../dbx-formats/tests/fixtures/redis_java.json")).unwrap();
        for fixture in fixtures {
            let bytes = fixture["hex"]
                .as_str()
                .unwrap()
                .as_bytes()
                .chunks_exact(2)
                .map(|pair| u8::from_str_radix(std::str::from_utf8(pair).unwrap(), 16).unwrap())
                .collect::<Vec<_>>();
            let display = dbx_core::db::redis_driver::redis_key_bytes_to_display(&bytes);
            assert_eq!(
                decode_redis_result(&json!(display)),
                json!({"codec":"java-serialized","value":fixture["expected"]}),
                "{}",
                fixture["name"]
            );
        }
    }

    #[test]
    fn shares_expansion_budget_across_a_large_mget_reply() {
        // Every reference repeats the same string in normalized JSON, just as
        // the desktop codec does. Small binary input can therefore expand.
        let mut bytes = vec![0xac, 0xed, 0, 5, 0x74];
        bytes.extend(30_000_u16.to_be_bytes());
        bytes.extend(vec![b'a'; 30_000]);
        for _ in 0..100 {
            bytes.extend([0x71, 0, 0x7e, 0, 0]);
        }
        let display = dbx_core::db::redis_driver::redis_key_bytes_to_display(&bytes);
        let input = json!(vec![display.clone(); 20]);
        let output = decode_redis_result(&input);
        let values = output.as_array().unwrap();
        assert!(values[0].is_object());
        assert_eq!(values.last().unwrap(), &json!(display));
        let expanded_bytes = serde_json::to_vec(&output).unwrap().len();
        assert!(expanded_bytes < 20 * 1024 * 1024, "{expanded_bytes}");
    }
}
