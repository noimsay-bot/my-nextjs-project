// Test-process guard. Never load this module in the application runtime.
const net = require("node:net");
const { syncBuiltinESMExports } = require("node:module");
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const normalized = net._normalizeArgs(args)[0];
  const host = normalized.host || "localhost";
  if (!normalized.path && !["127.0.0.1", "::1", "localhost"].includes(host)) {
    throw new Error("Offline test blocked a non-loopback network connection");
  }
  return connect.apply(this, args);
};
syncBuiltinESMExports();
