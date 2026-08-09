import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

// The pinned 2.0.0 client exposes only pid publicly, so contain its ChildProcess access here.
export class OwnedStdioClientTransport extends StdioClientTransport {
  constructor(parameters, registry, ownership = {}) {
    super(parameters);
    this.registry = registry;
    this.ownership = ownership;
    this.ownedProcess = undefined;
  }

  captureOwnedProcess() {
    const child = this._process;
    if (child && this.ownedProcess?.child !== child) {
      this.ownedProcess = this.registry.register(child, {
        group: false,
        label: this.ownership.label ?? "MCP stdio child",
        terminateTree: true,
      });
    }
    return this.ownedProcess;
  }

  async start() {
    let started;
    try {
      started = super.start();
      this.captureOwnedProcess();
      return await started;
    } finally {
      this.captureOwnedProcess();
    }
  }

  async send(message, options) {
    this.captureOwnedProcess();
    return super.send(message, options);
  }

  async close() {
    this.captureOwnedProcess();
    return super.close();
  }
}
