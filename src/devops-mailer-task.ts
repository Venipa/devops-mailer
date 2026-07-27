import * as task from "azure-pipelines-task-lib/task";
import Handlebars from "handlebars";
import { marked } from "marked";
import { stat } from "node:fs/promises";
import nodemailer from "nodemailer";

interface SmtpConfiguration {
  readonly host: string;
  readonly port: number;
  readonly secure: boolean;
  readonly username: string;
  readonly password: string;
  readonly ignoreTls: boolean;
  readonly requireTls: boolean;
}

interface MessageConfiguration {
  readonly title: string;
  readonly fromAddress: string;
  readonly recipients: readonly string[];
  readonly ccRecipients: readonly string[];
  readonly bccRecipients: readonly string[];
  readonly subjectTemplate: string;
  readonly bodyTemplate: string;
  readonly attachmentPaths: readonly string[];
  readonly contentFormat: ContentFormat;
  readonly templateContext: Record<string, unknown>;
}

type ContentFormat = "text" | "html" | "markdown";

interface PipelineContext {
  readonly variables: Record<string, string>;
  readonly pipelineVariables: Record<string, unknown>;
  readonly outputVariables: Record<string, string>;
  readonly outputPipelineVariables: Record<string, unknown>;
  readonly environmentVariables: Record<string, string>;
  readonly environmentPipelineVariables: Record<string, unknown>;
}

const parseBooleanInput = (value: string | undefined): boolean => {
  if (!value) {
    return false;
  }

  const normalizedValue: string = value.trim().toLowerCase();
  return normalizedValue === "true" || normalizedValue === "1" || normalizedValue === "yes";
};

const parseContentFormat = (rawContentFormat: string | undefined): ContentFormat => {
  const normalizedContentFormat: string = (rawContentFormat ?? "text").trim().toLowerCase();
  if (
    normalizedContentFormat !== "text" &&
    normalizedContentFormat !== "html" &&
    normalizedContentFormat !== "markdown"
  ) {
    throw new Error(
      `Invalid contentFormat value "${rawContentFormat}". Use one of: text, html, markdown.`
    );
  }

  return normalizedContentFormat;
};

const getRequiredInput = (inputName: string): string => {
  const value: string | undefined = task.getInput(inputName, true);
  if (!value || value.trim().length === 0) {
    throw new Error(`Task input "${inputName}" is required.`);
  }

  return value.trim();
};

const parseRecipients = (rawRecipients: string): readonly string[] => {
  const recipients: readonly string[] = rawRecipients
    .split(/[\n,;]+/g)
    .map((recipient: string) => recipient.trim())
    .filter((recipient: string) => recipient.length > 0);

  if (recipients.length === 0) {
    throw new Error("At least one recipient must be provided.");
  }

  return recipients;
};

const parseOptionalRecipients = (rawRecipients: string | undefined): readonly string[] => {
  if (!rawRecipients || rawRecipients.trim().length === 0) {
    return [];
  }

  return rawRecipients
    .split(/[\n,;]+/g)
    .map((recipient: string) => recipient.trim())
    .filter((recipient: string) => recipient.length > 0);
};

const parseAttachmentPaths = (rawAttachments: string | undefined): readonly string[] => {
  if (!rawAttachments || rawAttachments.trim().length === 0) {
    return [];
  }

  return rawAttachments
    .split(/\r?\n/g)
    .map((attachmentPath: string) => attachmentPath.trim())
    .filter((attachmentPath: string) => attachmentPath.length > 0);
};

const validateAttachmentPaths = async (
  attachmentPaths: readonly string[]
): Promise<readonly string[]> => {
  const missingAttachmentPaths: string[] = [];

  await Promise.all(
    attachmentPaths.map(async (attachmentPath: string): Promise<void> => {
      try {
        await stat(attachmentPath);
      } catch (error: unknown) {
        missingAttachmentPaths.push(attachmentPath);
      }
    })
  );

  if (missingAttachmentPaths.length > 0) {
    throw new Error(
      `Attachment file(s) not found: ${missingAttachmentPaths.join(", ")}`
    );
  }

  return attachmentPaths;
};

const setNestedValue = (
  target: Record<string, unknown>,
  dottedKey: string,
  value: string
): void => {
  const segments: readonly string[] = dottedKey.split(".").filter((segment: string) => segment.length > 0);
  if (segments.length === 0) {
    return;
  }

  let currentNode: Record<string, unknown> = target;
  segments.forEach((segment: string, index: number) => {
    const isLeafNode: boolean = index === segments.length - 1;
    if (isLeafNode) {
      currentNode[segment] = value;
      return;
    }

    const nextNode: unknown = currentNode[segment];
    if (typeof nextNode !== "object" || nextNode === null || Array.isArray(nextNode)) {
      currentNode[segment] = {};
    }

    currentNode = currentNode[segment] as Record<string, unknown>;
  });
};

const normalizeEnvironmentVariableName = (environmentVariableName: string): string =>
  environmentVariableName.toLowerCase().replace(/__/g, ".").replace(/_/g, ".");

const isPotentialOutputVariable = (variableName: string): boolean => {
  const outputVariablePattern: RegExp = /^(dependencies|stageDependencies)\./i;
  if (outputVariablePattern.test(variableName)) {
    return true;
  }

  const isSystemVariable: boolean =
    variableName.startsWith("BUILD_") ||
    variableName.startsWith("SYSTEM_") ||
    variableName.startsWith("AGENT_") ||
    variableName.startsWith("PIPELINE_") ||
    variableName.startsWith("RELEASE_");

  return !isSystemVariable && variableName.includes("_");
};

const buildPipelineContext = (): PipelineContext => {
  const variableMap: Record<string, string> = {};
  const pipelineVariableMap: Record<string, unknown> = {};
  const outputVariableMap: Record<string, string> = {};
  const outputPipelineVariableMap: Record<string, unknown> = {};
  const environmentVariableMap: Record<string, string> = {};
  const environmentPipelineVariableMap: Record<string, unknown> = {};

  const taskVariables: readonly task.VariableInfo[] = task.getVariables();
  taskVariables.forEach((variable: task.VariableInfo) => {
    if (!variable.name) {
      return;
    }

    const variableValue: string = variable.value ?? "";
    variableMap[variable.name] = variableValue;
    setNestedValue(pipelineVariableMap, variable.name, variableValue);
  });

  Object.entries(process.env).forEach(([environmentVariableName, environmentVariableValue]) => {
    if (!environmentVariableValue) {
      return;
    }

    environmentVariableMap[environmentVariableName] = environmentVariableValue;
    const normalizedVariableName: string = normalizeEnvironmentVariableName(environmentVariableName);
    setNestedValue(environmentPipelineVariableMap, normalizedVariableName, environmentVariableValue);

    if (isPotentialOutputVariable(environmentVariableName)) {
      outputVariableMap[environmentVariableName] = environmentVariableValue;
      setNestedValue(outputPipelineVariableMap, normalizedVariableName, environmentVariableValue);
    }
  });

  return {
    variables: variableMap,
    pipelineVariables: pipelineVariableMap,
    outputVariables: outputVariableMap,
    outputPipelineVariables: outputPipelineVariableMap,
    environmentVariables: environmentVariableMap,
    environmentPipelineVariables: environmentPipelineVariableMap,
  };
};

const parseTemplateContext = (rawContext: string | undefined): Record<string, unknown> => {
  if (!rawContext || rawContext.trim().length === 0) {
    return {};
  }

  try {
    const parsedContext: unknown = JSON.parse(rawContext);
    if (typeof parsedContext !== "object" || parsedContext === null || Array.isArray(parsedContext)) {
      throw new Error("Template context must be a JSON object.");
    }

    return parsedContext as Record<string, unknown>;
  } catch (error: unknown) {
    const errorMessage: string =
      error instanceof Error ? error.message : "Unknown JSON parsing error.";
    throw new Error(`Invalid templateContext JSON: ${errorMessage}`);
  }
};

const renderTemplate = (
  template: string,
  context: Record<string, unknown>,
  templateName: string
): string => {
  try {
    const compiler: HandlebarsTemplateDelegate = Handlebars.compile(template);
    return compiler(context);
  } catch (error: unknown) {
    const errorMessage: string =
      error instanceof Error ? error.message : "Unknown Handlebars rendering error.";
    throw new Error(`Failed to render ${templateName} template: ${errorMessage}`);
  }
};

const loadMessageConfiguration = (): MessageConfiguration => {
  const title: string = getRequiredInput("title");
  const fromAddress: string = getRequiredInput("fromAddress");
  const recipients: readonly string[] = parseRecipients(getRequiredInput("to"));
  const ccRecipients: readonly string[] = parseOptionalRecipients(task.getInput("cc"));
  const bccRecipients: readonly string[] = parseOptionalRecipients(task.getInput("bcc"));
  const subjectTemplate: string = getRequiredInput("subject");
  const bodyTemplate: string = getRequiredInput("content");
  const attachmentPaths: readonly string[] = parseAttachmentPaths(task.getInput("attachments"));
  const contentFormat: ContentFormat = parseContentFormat(task.getInput("contentFormat"));
  const templateContext: Record<string, unknown> = parseTemplateContext(task.getInput("templateContext"));

  return {
    title,
    fromAddress,
    recipients,
    ccRecipients,
    bccRecipients,
    subjectTemplate,
    bodyTemplate,
    attachmentPaths,
    contentFormat,
    templateContext,
  };
};

const loadSmtpConfiguration = (): SmtpConfiguration => {
  const host: string = getRequiredInput("smtpHost");
  const portValue: string = getRequiredInput("smtpPort");
  const parsedPort: number = Number.parseInt(portValue, 10);
  const isPortValid: boolean = Number.isInteger(parsedPort) && parsedPort > 0 && parsedPort <= 65535;
  if (!isPortValid) {
    throw new Error(`Invalid smtpPort value "${portValue}". Use integer between 1 and 65535.`);
  }

  return {
    host,
    port: parsedPort,
    secure: parseBooleanInput(task.getInput("smtpSecure")),
    username: getRequiredInput("smtpUsername"),
    password: getRequiredInput("smtpPassword"),
    ignoreTls: parseBooleanInput(task.getInput("smtpIgnoreTLS")),
    requireTls: parseBooleanInput(task.getInput("smtpRequireTLS")),
  };
};

const run = async (): Promise<void> => {
  try {
    const messageConfiguration: MessageConfiguration = loadMessageConfiguration();
    const validatedAttachmentPaths: readonly string[] = await validateAttachmentPaths(
      messageConfiguration.attachmentPaths
    );
    const smtpConfiguration: SmtpConfiguration = loadSmtpConfiguration();
    const pipelineContext: PipelineContext = buildPipelineContext();

    const templateRuntimeContext: Record<string, unknown> = {
      title: messageConfiguration.title,
      variables: pipelineContext.variables,
      pipeline: pipelineContext.pipelineVariables,
      pipelineVariables: pipelineContext.pipelineVariables,
      outputVariables: pipelineContext.outputVariables,
      outputPipelineVariables: pipelineContext.outputPipelineVariables,
      env: pipelineContext.environmentVariables,
      envPipeline: pipelineContext.environmentPipelineVariables,
      ...messageConfiguration.templateContext,
    };

    const renderedSubject: string = renderTemplate(
      messageConfiguration.subjectTemplate,
      templateRuntimeContext,
      "subject"
    );
    const renderedContent: string = renderTemplate(
      messageConfiguration.bodyTemplate,
      templateRuntimeContext,
      "content"
    );
    const renderedHtmlContent: string = await Promise.resolve(marked.parse(renderedContent, {gfm: true}));

    const transporter = nodemailer.createTransport({
      host: smtpConfiguration.host,
      port: smtpConfiguration.port,
      secure: smtpConfiguration.secure,
      auth: {
        user: smtpConfiguration.username,
        pass: smtpConfiguration.password,
      },
      ignoreTLS: smtpConfiguration.ignoreTls,
      requireTLS: smtpConfiguration.requireTls,
    });

    const mailOptions = {
      from: messageConfiguration.fromAddress,
      to: messageConfiguration.recipients.join(", "),
      ...(messageConfiguration.ccRecipients.length > 0
        ? { cc: messageConfiguration.ccRecipients.join(", ") }
        : {}),
      ...(messageConfiguration.bccRecipients.length > 0
        ? { bcc: messageConfiguration.bccRecipients.join(", ") }
        : {}),
      subject: renderedSubject,
      headers: {
        "X-Message-Title": messageConfiguration.title,
      },
      ...(validatedAttachmentPaths.length > 0
        ? {
            attachments: validatedAttachmentPaths.map((attachmentPath: string) => ({
              path: attachmentPath,
            })),
          }
        : {}),
      ...(messageConfiguration.contentFormat === "html"
        ? { html: renderedContent }
        : {}),
      ...(messageConfiguration.contentFormat === "markdown"
        ? { html: renderedHtmlContent }
        : {}),
      ...(messageConfiguration.contentFormat === "text"
        ? { text: renderedContent }
        : {}),
    };

    const info = await transporter.sendMail(mailOptions);
    task.debug(`SMTP response: ${info.response}`);
    task.setResult(task.TaskResult.Succeeded, `Mail sent to ${messageConfiguration.recipients.length} recipient(s).`);
  } catch (error: unknown) {
    const errorMessage: string = error instanceof Error ? error.message : "Unknown task error.";
    task.setResult(task.TaskResult.Failed, errorMessage);
  }
};

void run();
