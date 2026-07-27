# DevOps Mailer

DevOps Mailer is an Azure DevOps extension task that sends SMTP email from pipeline jobs.  
Subject and body support Handlebars templating with pipeline variables and custom JSON context.

## What You Get

- Send email to one or many recipients.
- Use plain text or HTML body.
- Use Handlebars templates in subject and body.
- Inject custom data with `templateContext`.
- Use secure SMTP credentials from pipeline secret variables.

## Install And Use In Pipeline

1. Publish/install extension `.vsix` in your Azure DevOps organization.
2. Add task `devops-mailer@0` to YAML pipeline.
3. Store SMTP username/password in variable group or secret pipeline variables.

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

## HTML Example

```yaml
steps:
  - task: devops-mailer@0
    displayName: Send HTML summary
    inputs:
      title: "Build {{variables.BUILD_BUILDNUMBER}}"
      to: team@example.com
      fromAddress: noreply@example.com
      subject: "{{title}} - {{variables.AGENT_JOBSTATUS}}"
      content: |
        <h2>{{title}}</h2>
        <p>Branch: <b>{{variables.BUILD_SOURCEBRANCHNAME}}</b></p>
        <p>Status: <b>{{variables.AGENT_JOBSTATUS}}</b></p>
      isBodyHtml: true
      templateContext: "{}"
      smtpHost: smtp.example.com
      smtpPort: 587
      smtpSecure: false
      smtpUsername: $(smtp.user)
      smtpPassword: $(smtp.password)
      smtpIgnoreTLS: false
      smtpRequireTLS: true
```

## Template Variables

Inside `subject` and `content` templates:

- `{{title}}` from task input.
- `{{variables.BUILD_BUILDNUMBER}}` flat pipeline env variable.
- `{{pipeline.Build.BuildNumber}}` nested pipeline access.
- `{{pipelineVariables.Build.BuildNumber}}` alias for nested pipeline access.
- `{{outputVariables.MY_TASK_MY_OUTPUT}}` output-like env variable access.
- `{{outputPipelineVariables.my.task.my.output}}` nested output-like env variable access.
- `{{env.SYSTEM_TEAMPROJECT}}` raw environment variable access.
- `{{envPipeline.system.teamproject}}` nested environment variable access.
- any key from JSON in `templateContext`.

## SMTP Notes

- Use `smtpSecure: true` for implicit TLS (usually port 465).
- Use `smtpSecure: false` + `smtpRequireTLS: true` for STARTTLS (usually port 587).
- Keep `smtpPassword` in secret variable, never plain text in YAML.

## Build Extension Locally

```bash
bun run build:task
bun run build:release
bun run package:extension
```

- Build output task script: `dist/tasks/devops-mailer/index.js`
- Packaged extension output: `release/*.vsix`
