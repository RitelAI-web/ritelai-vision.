# RitelAI MT5 Multi-Broker — safe preflight build

## Target demo profiles
- Exness: Standard Cent (user-selected)
- Versus Trade: Standard (user-selected)
- First instrument: XAUUSD
- Intended modes after full integration: Manual, Semi-Auto approval, Auto (Enterprise)

## What this commit provides
`RitelAI_Connector_Preflight.mq5` is a deliberately non-trading Expert Advisor. It:
- Detects broker company/server strings where recognizable.
- Requires a demo account by default.
- Resolves XAUUSD or a broker suffix variant from symbols available in Market Watch.
- Prints the terminal's actual digits, point, contract size, volume min/max/step, and trade mode.

## What it does NOT do
- It does not connect to the RitelAI signal backend.
- It does not send market or pending orders.
- It does not manage SL/TP or close positions.
- It does not prove broker connectivity or successful order execution.
- It does not infer account subtype (Standard Cent / Standard) with certainty; confirm that in the broker's account portal.

## Install and collect broker specifications
1. In each broker's MT5 desktop terminal, open MetaEditor.
2. Create an Expert Advisor named `RitelAI_Connector_Preflight`.
3. Replace its contents with the source in this folder and compile.
4. Attach it to the broker's XAUUSD chart. Keep Algo Trading disabled; this EA has no order-placement code.
5. Confirm the displayed broker, demo status, symbol name, digits, contract size and volume step. Send those diagnostics back for validation.

## Next integration gate
The authenticated signal queue, per-user EA credential issuance/revocation, server-side Enterprise entitlement, idempotent order requests, execution receipts, risk limits, stale-signal expiry, daily loss lockout, emergency stop, and broker-specific demo execution tests are not yet implemented. They must be completed before enabling Semi-Auto or Auto. Never put broker passwords or Supabase service-role keys in the EA or browser.
