# Browser verification · 2026-10-22 (Asia/Seoul)

Verified through the supported CUA browser against the exact static files in dist/.

| Scenario | Observed result |
| --- | --- |
| Required input validation | Empty name and unchecked consent showed both errors; count stayed at 8. |
| Form submission | Exact scenario values produced REQ-1043; total became 9; type and priority matched. |
| Modal | Opening displayed the dialog; cancel closed it; reopening and confirming recorded modal.confirm. |
| Table | Search returned one login row; aria-sort became ascending; one selection was completed; next page showed 2 / 3. |
| Navigation | URL reached #record/REQ-1042 and matching title/ID; list return and browser Back reached #pages. |
| Async | data-state=loading and disabled button observed; success became 200 OK; failure became 500 ERROR after about 1.5 seconds. |

All six scenarios reached completed state (6 / 6). No Claude or GPT external MCP connection was made as part of QA; the target site was exercised through CUA’s supported browser interactions.

Additional checks: localStorage preserved 6 completed scenarios and 9 records across reload; command copy placed the actual origin and scenario in the clipboard; error filter contained only error events; JSON download parsed with 32 events and six completed scenario IDs; status filter showed only completed rows; unmatched search showed a zero-result state and disabled Next; selector toggle displayed stable IDs; reset cancellation preserved state and confirmation restored 8 records / 0 completed scenarios. A 390px iframe viewport rendered the responsive layout without document overflow (375px content width after scrollbar), and bottom navigation opened all six scenario cards. The temporary viewport harness was removed before packaging.

Initial non-secure-preview crypto.randomUUID error was fixed with a feature-detected fallback; syntax rechecked. Network calls to external fonts were removed; the app uses system font fallbacks.
