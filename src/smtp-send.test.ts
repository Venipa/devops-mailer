import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";

import { TaskMockRunner } from "azure-pipelines-task-lib/mock-run";
import { SMTPServer } from "smtp-server";

const SMTP_USERNAME: string = "smtp-user";
const SMTP_PASSWORD: string = "smtp-pass";

let smtpServer: SMTPServer | null = null;
let smtpPort: number = 0;
let receivedMessages: string[] = [];

const startSmtpServer = async (): Promise<void> => {
  receivedMessages = [];

  smtpServer = new SMTPServer({
    secure: false,
    disabledCommands: ["STARTTLS"],
    authOptional: false,
    onAuth(auth, _session, callback): void {
      if (auth.username === SMTP_USERNAME && auth.password === SMTP_PASSWORD) {
        callback(null, { user: auth.username });
        return;
      }

      callback(new Error("Invalid SMTP credentials"));
    },
    onData(stream, _session, callback): void {
      let rawMessage = "";
      stream.setEncoding("utf8");

      stream.on("data", (chunk: string) => {
        rawMessage += chunk;
      });
      stream.on("end", () => {
        receivedMessages.push(rawMessage);
        callback();
      });
    },
  });

  await new Promise<void>((resolve, reject) => {
    if (!smtpServer) {
      reject(new Error("SMTP server not created"));
      return;
    }

    smtpServer.listen(0, "127.0.0.1", () => {
      if (!smtpServer?.server) {
        reject(new Error("SMTP server missing Node server instance"));
        return;
      }

      const address = smtpServer.server.address();
      if (!address || typeof address === "string") {
        reject(new Error("SMTP server address not available"));
        return;
      }

      smtpPort = (address as AddressInfo).port;
      resolve();
    });
  });
};

const stopSmtpServer = async (): Promise<void> => {
  if (!smtpServer) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    smtpServer?.close((error?: Error | null) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
  smtpServer = null;
};

describe("SMTP send integration", () => {
  beforeAll(async () => {
    await startSmtpServer();
  });

  afterAll(async () => {
    await stopSmtpServer();
  });

  it("sends one email through SMTP task script", async () => {
    const uniqueTitle: string = `Integration ${randomUUID()}`;
    const uniqueBodyMarker: string = `marker-${randomUUID()}`;

    const taskRunner: TaskMockRunner = new TaskMockRunner(
      require.resolve("./devops-mailer-task.ts")
    );

    taskRunner.setInput("title", uniqueTitle);
    taskRunner.setInput("to", "receiver@example.com");
    taskRunner.setInput("fromAddress", "sender@example.com");
    taskRunner.setInput("subject", "{{title}}");
    taskRunner.setInput("content", `Hello ${uniqueBodyMarker}`);
    taskRunner.setInput("isBodyHtml", "false");
    taskRunner.setInput("templateContext", "{}");
    taskRunner.setInput("smtpHost", "127.0.0.1");
    taskRunner.setInput("smtpPort", String(smtpPort));
    taskRunner.setInput("smtpSecure", "false");
    taskRunner.setInput("smtpUsername", SMTP_USERNAME);
    taskRunner.setInput("smtpPassword", SMTP_PASSWORD);
    taskRunner.setInput("smtpIgnoreTLS", "true");
    taskRunner.setInput("smtpRequireTLS", "false");

    taskRunner.registerMockExport("getVariables", () => [
      { name: "BUILD_BUILDNUMBER", value: "42" },
      { name: "BUILD_SOURCEBRANCHNAME", value: "main" },
      { name: "AGENT_JOBSTATUS", value: "Succeeded" },
    ]);

    expect(() => taskRunner.run()).not.toThrow();

    await new Promise<void>((resolve, reject) => {
      const startedAt: number = Date.now();
      const pollId: ReturnType<typeof setInterval> = setInterval(() => {
        if (receivedMessages.length > 0) {
          clearInterval(pollId);
          resolve();
          return;
        }

        if (Date.now() - startedAt > 4000) {
          clearInterval(pollId);
          reject(new Error("SMTP message not received within timeout"));
        }
      }, 50);
    });

    expect(receivedMessages.length).toBe(1);
    expect(receivedMessages[0]).toContain(`Subject: ${uniqueTitle}`);
    expect(receivedMessages[0]).toContain(uniqueBodyMarker);
  });
});
