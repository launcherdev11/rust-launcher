import { Component, type ErrorInfo, type ReactNode } from "react";
import { t, type Language } from "../../i18n";
import { copyTextToClipboard } from "../../lib/clipboard";
import { ErrorState } from "./StateView";

type Props = {
  language: Language;
  tabName: string;
  children: ReactNode;
};

type State = {
  error: Error | null;
  componentStack: string;
  attempt: number;
  copied: boolean;
};

export class TabErrorBoundary extends Component<Props, State> {
  state: State = { error: null, componentStack: "", attempt: 0, copied: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error, copied: false };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[${this.props.tabName}] render failed:`, error, info.componentStack);
    this.setState({ componentStack: info.componentStack ?? "" });
  }

  private reload = () => {
    this.setState((s) => ({ error: null, componentStack: "", attempt: s.attempt + 1 }));
  };

  private copyDetails = async () => {
    const { error, componentStack } = this.state;
    if (!error) return;
    const text = [
      `Tab: ${this.props.tabName}`,
      `${error.name}: ${error.message}`,
      error.stack ?? "",
      componentStack,
    ]
      .filter(Boolean)
      .join("\n");
    const ok = await copyTextToClipboard(text);
    this.setState({ copied: ok });
  };

  render() {
    const { error, attempt, copied } = this.state;
    const { language, children } = this.props;
    if (!error) {
      return <div key={attempt} className="contents">{children}</div>;
    }
    return (
      <div className="flex min-h-0 w-full flex-1 items-center justify-center p-6">
        <ErrorState
          title={t(language, "common.state.tabCrashed")}
          description={t(language, "common.state.tabCrashedHint")}
          details={error.message}
          action={
            <>
              <button type="button" className="btn btn-accent btn-sm" onClick={this.reload}>
                {t(language, "common.state.reloadTab")}
              </button>
              <button type="button" className="btn btn-soft btn-sm" onClick={this.copyDetails}>
                {copied ? t(language, "common.state.copied") : t(language, "common.state.copyDetails")}
              </button>
            </>
          }
        />
      </div>
    );
  }
}
