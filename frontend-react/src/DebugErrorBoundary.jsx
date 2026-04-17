import React from "react";

export default class DebugErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      stack: "",
    };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    this.setState({
      stack: info?.componentStack || "",
    });
    console.error("Erro capturado pela ErrorBoundary:", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: "24px", fontFamily: "Arial, sans-serif", background: "#f8fafc", minHeight: "100vh" }}>
          <h2 style={{ marginBottom: "16px" }}>Erro na interface autenticada</h2>

          <div style={{ marginBottom: "12px", padding: "12px", background: "#fff", border: "1px solid #ddd", borderRadius: "8px" }}>
            <strong>Erro:</strong>
            <pre style={{ whiteSpace: "pre-wrap", marginTop: "8px" }}>
              {String(this.state.error)}
            </pre>
          </div>

          <div style={{ padding: "12px", background: "#fff", border: "1px solid #ddd", borderRadius: "8px" }}>
            <strong>Stack:</strong>
            <pre style={{ whiteSpace: "pre-wrap", marginTop: "8px" }}>
              {this.state.stack}
            </pre>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
