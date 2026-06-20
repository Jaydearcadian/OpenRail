import type { Dispatch } from "react";
import type { ActivityEvent, DashboardAction } from "../../types/dashboard";

interface ActivityFeedProps {
  events: ActivityEvent[];
  onNavigate: Dispatch<DashboardAction>;
}

export function ActivityFeed({ events, onNavigate }: ActivityFeedProps) {
  return (
    <section className="panel activity-feed" aria-labelledby="activity-title">
      <div className="panel-heading compact">
        <span>Recent changes</span>
        <h2 id="activity-title">Activity feed</h2>
      </div>
      <div className="activity-list">
        {events.length === 0 ? (
          <button type="button" disabled>
            <span className="activity-dot activity-info" aria-hidden="true" />
            <span>
              <strong>No live activity yet</strong>
              <small>Worker stream and receipt events will appear here after loading.</small>
            </span>
            <em>pending</em>
          </button>
        ) : events.map((event) => (
          <button key={event.id} type="button" onClick={() => onNavigate({ type: "set-route", route: event.route })}>
            <span className={`activity-dot activity-${event.status}`} aria-hidden="true" />
            <span>
              <strong>{event.title}</strong>
              <small>{event.description}</small>
            </span>
            <em>{event.time}</em>
          </button>
        ))}
      </div>
    </section>
  );
}
