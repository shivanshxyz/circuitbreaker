import { MissionControl } from "@/components/mission-control";

export default function Home() {
  return (
    <main className="shell">
      <header className="masthead">
        <div>
          <h1>CircuitBreaker</h1>
        </div>
        <div className="network">
          <span className="status-dot" aria-hidden="true" />
          Base mainnet
        </div>
      </header>

      <section className="hero" aria-labelledby="mission-title">
        <div className="hero-copy">
          <h2 id="mission-title">
            Agents can act.
            <br />
            Policy decides how.
          </h2>
          <p>
            Composer constrains the transaction. CircuitBreaker evaluates risk.
            Ledger approves elevated actions. Dynamic executes.
          </p>
        </div>
      </section>

      <MissionControl />

      <section className="proof-panel" aria-labelledby="proof-title">
        <div>
          <h2 id="proof-title">Test Transactions</h2>
        </div>
        <div className="proof-links">
          <a
            href="https://basescan.org/tx/0x20ed429ea64e3b6bf6083892a267ac55da979c93e7cc99f0d5ceb61c4704dead"
            rel="noreferrer"
            target="_blank"
          >
            Exact USDC approval
          </a>
          <a
            href="https://basescan.org/tx/0x3a459502c222b10ca04013b0b1f12abd7609322104f67b78cd50ace351fbd8bd"
            rel="noreferrer"
            target="_blank"
          >
            Composer execution
          </a>
        </div>
      </section>
    </main>
  );
}
