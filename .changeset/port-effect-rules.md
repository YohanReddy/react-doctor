---
"@react-doctor/core": patch
"eslint-plugin-react-doctor": patch
"oxlint-plugin-react-doctor": patch
"react-doctor": patch
---

Natively port the 8 rules from `eslint-plugin-react-you-might-not-need-an-effect`
(NickvanDyke, MIT) into `oxlint-plugin-react-doctor`. They now ship as
`react-doctor/*` rules and no longer require the optional peer
dependency. The optional peer-dep surface (`effect/*` rules,
`resolveYouMightNotNeedEffectPlugin`,
`YOU_MIGHT_NOT_NEED_EFFECT_NAMESPACE`) is removed from
`@react-doctor/core`.

The ports use a real `eslint-scope` ScopeManager (cached per Program
via `WeakMap`) — same `references` / `resolved.defs[].node.init` /
`isEventualCallTo` chasing the upstream plugin uses. Diagnostic
messages match upstream verbatim with template variables substituted
in JS.

| Rule (now `react-doctor/<id>`)      | What it catches                                                          |
| ----------------------------------- | ------------------------------------------------------------------------ |
| `no-derived-state`                  | Storing derived state via a useEffect instead of computing during render |
| `no-chain-state-updates`            | Chaining state updates across effects                                    |
| `no-event-handler`                  | Using state + a guarded effect as an event handler                       |
| `no-adjust-state-on-prop-change`    | Adjusting state in an effect when a prop changes                         |
| `no-reset-all-state-on-prop-change` | Resetting all state in an effect (use a `key` prop)                      |
| `no-pass-live-state-to-parent`      | Pushing live state to a parent via a callback in an effect               |
| `no-pass-data-to-parent`            | Passing fetched data to a parent via a callback in an effect             |
| `no-initialize-state`               | Initializing state inside a mount-only effect                            |

Parity coverage: 195 of 196 upstream test cases pass (the 1 remaining
case is upstream's own `todo: true`, "Set derived state via identical
intermediate setter").

These coexist with React Doctor's existing thematically-related rules
(`no-derived-state-effect`, `no-effect-chain`, `no-event-trigger-state`,
`no-prop-callback-in-effect`) — different IDs, different shapes,
different messages.
