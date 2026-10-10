# Test fixtures — throwaway keys

Both key pairs in this folder are **synthetic, single-purpose test data**
generated with `ssh-keygen` at development time. They are committed so the
`decode_private_key` unit tests in `src/ssh.rs` run offline on any machine.

- `plain_test_key` — unencrypted ed25519 key, no passphrase
- `encrypted_test_key` — the same key encrypted with the passphrase
  `mobaxtauri-test-passphrase`, which is intentionally visible in the test
  source (`FIXTURE_PASSPHRASE`) because the tests must decrypt it

Neither key can ever open a real account: it has never been registered with
an authorized_keys entry anywhere, and you cannot derive sensitive material
from it. Do not replace these with your own keys. If you need new fixtures,
generate them fresh with:

```sh
ssh-keygen -t ed25519 -N "" -f plain_test_key -C "mobaxtauri-fixture-plain"
ssh-keygen -t ed25519 -N mobaxtauri-test-passphrase -f encrypted_test_key -C "mobaxtauri-fixture"
```
