import type { Dispatch } from "react";
import { scenarioOptions, web3StateOptions } from "../../data/mock";
import type { DashboardAction, DashboardState } from "../../types/dashboard";

interface SettingsSurfaceProps {
  state: DashboardState;
  dispatch: Dispatch<DashboardAction>;
}

export function SettingsSurface({ state, dispatch }: SettingsSurfaceProps) {
  return (
    <div className="settings-grid">
      <section className="panel settings-panel">
        <div className="panel-heading compact">
          <span>Worker data scenarios</span>
          <h2>Surface states</h2>
        </div>
        <div className="settings-options">
          {scenarioOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              className={state.scenario === option.value ? "active" : ""}
              aria-pressed={state.scenario === option.value}
              onClick={() => dispatch({ type: "set-scenario", scenario: option.value })}
            >
              <strong>{option.label}</strong>
              <span>{option.description}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="panel settings-panel">
        <div className="panel-heading compact">
          <span>Future web3 states</span>
          <h2>Wallet and transaction previews</h2>
        </div>
        <div className="settings-options">
          {web3StateOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              className={state.web3State === option.value ? "active" : ""}
              aria-pressed={state.web3State === option.value}
              onClick={() => dispatch({ type: "set-web3-state", web3State: option.value })}
            >
              <strong>{option.label}</strong>
              <span>{option.description}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
