import { Component, ErrorInfo, ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";

interface Props {
  children?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("ErrorBoundary caught an error:", error, errorInfo);
    this.setState({ errorInfo });
    invoke("log_to_terminal", {
      level: "error",
      message: `React Error Boundary caught crash: ${error?.stack || error}\nComponent Stack:\n${errorInfo?.componentStack}`
    }).catch((err) => console.error("Failed to log crash to terminal:", err));
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-screen w-screen flex-col items-center justify-center bg-[#0d0e12] text-zinc-100 font-sans p-6 overflow-auto">
          <div className="max-w-2xl w-full bg-zinc-900 border border-rose-500/30 rounded-xl p-6 shadow-2xl space-y-4">
            <h1 className="text-rose-400 font-bold text-lg flex items-center space-x-2">
              <span>⚠️ Application Crashed</span>
            </h1>
            <p className="text-xs text-zinc-400">
              An unhandled error occurred in the React component tree.
            </p>
            <div className="bg-zinc-950 p-4 rounded-lg border border-zinc-800 font-mono text-xs text-rose-300 overflow-x-auto whitespace-pre-wrap">
              {this.state.error && this.state.error.toString()}
            </div>
            {this.state.errorInfo && (
              <div className="bg-zinc-950 p-4 rounded-lg border border-zinc-800 font-mono text-[10px] text-zinc-500 overflow-x-auto whitespace-pre-wrap max-h-60">
                {this.state.errorInfo.componentStack}
              </div>
            )}
            <div className="flex space-x-2 pt-2">
              <button
                onClick={() => window.location.reload()}
                className="bg-indigo-600 hover:bg-indigo-500 text-white font-mono font-bold text-xs px-4 py-2 rounded-lg transition-colors cursor-pointer"
              >
                Reload Application
              </button>
              <button
                onClick={() => this.setState({ hasError: false, error: null, errorInfo: null })}
                className="bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-mono font-bold text-xs px-4 py-2 rounded-lg transition-colors cursor-pointer"
              >
                Reset State
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
