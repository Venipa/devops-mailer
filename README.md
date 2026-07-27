# devops-mailer

Azure DevOps extension with custom task for sending SMTP email to multiple recipients.  
Task supports Handlebars templates for subject/content using pipeline variables plus custom JSON context.

## Build Task Bundle

```bash
bun run build:task
```

Generates runnable task script at `dist/tasks/devops-mailer/index.js`.

## Prepare Release Files

```bash
bun run build:release
```

Copies extension manifests and docs into `dist/` for packaging.
Also copies `package.json` and installs production-only dependencies in `dist/node_modules`.

## Package Extension

Package:

```bash
bun run package:extension
```

Output `.vsix` file created in `dist/`.

## Template Context

Inside templates:

- `{{title}}` -> task title input
- `{{variables.BUILD_BUILDNUMBER}}` -> flat pipeline variables (original names)
- `{{pipeline.Build.BuildNumber}}` -> nested pipeline variable access (dot notation transformed)
- `{{pipelineVariables.Build.BuildNumber}}` -> alias for nested pipeline variables
- `{{outputVariables.MY_TASK_MY_OUTPUT}}` -> output-like env variable access
- `{{outputPipelineVariables.my.task.my.output}}` -> nested output-like env access
- `{{env.SYSTEM_TEAMPROJECT}}` -> raw environment variables
- `{{envPipeline.system.teamproject}}` -> nested environment variable access
- Any keys from `templateContext` JSON input

## YAML Example

```yaml
steps:
  - task: devops-mailer@0
    displayName: Send deployment email
    inputs:
      title: Production deploy build {{variables.BUILD_BUILDNUMBER}}
      to: |
        dev1@example.com
        dev2@example.com
      fromAddress: noreply@example.com
      subject: "[{{variables.BUILD_SOURCEBRANCHNAME}}] {{title}} #{{variables.BUILD_BUILDNUMBER}}"
      content: |
        Hello team,

        Build number: {{variables.BUILD_BUILDNUMBER}}
        Status: {{variables.AGENT_JOBSTATUS}}
        Release environment: {{environment}}
      isBodyHtml: false
      templateContext: |
        {
          "environment": "production"
        }
      smtpHost: smtp.example.com
      smtpPort: 587
      smtpSecure: false
      smtpUsername: $(smtp.user)
      smtpPassword: $(smtp.password)
      smtpIgnoreTLS: false
      smtpRequireTLS: true
```
