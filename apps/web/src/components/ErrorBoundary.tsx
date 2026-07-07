import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode; label?: string };
type State = { error: Error | null };

/**
 * Catches render/runtime errors in its subtree so a crash in one panel (e.g. the
 * heavy score renderer) can never black out the entire app. The rest of the page
 * — including the download buttons — stays usable.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error(`[ErrorBoundary${this.props.label ? ` ${this.props.label}` : ""}]`, error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="score-error" style={{
          padding: "12px 14px", borderRadius: 8,
          background: "rgba(220,80,80,0.12)", border: "1px solid rgba(220,80,80,0.4)",
        }}>
          <b>Preview couldn’t be displayed</b> — the arrangement is fine and your
          downloads still work. {this.props.label ? `(${this.props.label}) ` : ""}
          Open the downloaded MusicXML/MIDI to view the full score.
        </div>
      );
    }
    return this.props.children;
  }
}
