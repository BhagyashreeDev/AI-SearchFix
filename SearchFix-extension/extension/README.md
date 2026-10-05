# SearchFix extension 1.6.1

Load this folder in chrome://extensions and keep DataTrace signed in. Click Scan the page, save your Gemini key, then click Start analysis beside an order. Each button runs only that order. Clicking the order number opens its Overview in the same original tab.

Click the row or arrow to expand/collapse order details without losing findings. Expand Chosen comment for the AI-selected original text and explanation. Internal selections finish Ignored; client operational tasks finish Accepted without documents. Discrepancies use current evidence and show filenames, findings, reasons and next steps. Missing or inconclusive evidence requires review.

This build targets https://searchfix-deployment.onrender.com. The backend must also be updated to 1.6.1. Keys are saved only for the browser session without verification calls. Historical records are not used. The extension reads order data without editing fields or claiming tasks. After extracting TA, it uses Save and Close on its own unchanged TA window; failed saves leave the window open for manual attention.
