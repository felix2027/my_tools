# Upstream synchronization (2026-11-08)

worker.js matches ymyuuu/Cloudflare-Workers-Proxy commit
142d149603799bad206e9e3870275d0094f8af92 exactly, Git blob e7245a94fac5bc725dac1362c9b0d27dae2df7d0.
https://github.com/ymyuuu/Cloudflare-Workers-Proxy/blob/142d149603799bad206e9e3870275d0094f8af92/worker.js

Changes versus the prior local copy are homepage assets, removal of the background image, dark mode, and formatting. Proxy core behavior is unchanged.
Syntax validation and mocked-network homepage/forwarding/header-filtering/error-response smoke tests pass. No deploy or push occurred.

Known upstream limitations remain: relative Location redirect URLs are not resolved against the target URL; spreading a Headers object does not retain normal headers in the redirect branch. This is an upstream sync, not a complete security audit. Public forwarding and permissive CORS remain upstream behavior.
