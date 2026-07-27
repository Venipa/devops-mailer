import { cp, mkdir } from "node:fs/promises";

const RELEASE_ROOT: string = "dist";
const RELEASE_TASK_DIRECTORY: string = `${RELEASE_ROOT}/tasks/devops-mailer`;
const RELEASE_OUTPUT_ROOT: string = "release";

const prepareReleaseFiles = async (): Promise<void> => {
  await mkdir(RELEASE_TASK_DIRECTORY, { recursive: true });
  await mkdir(RELEASE_OUTPUT_ROOT, { recursive: true });

  await cp("src/tasks/devops-mailer/task.json", `${RELEASE_TASK_DIRECTORY}/task.json`);
  await cp("src/vss-extension.json", `${RELEASE_ROOT}/vss-extension.json`);
  await cp("src/icon.png", `${RELEASE_ROOT}/icon.png`);
  await cp("src/icon.png", `${RELEASE_TASK_DIRECTORY}/icon.png`);
  await cp("package.json", `${RELEASE_TASK_DIRECTORY}/package.json`);
  await cp("README.md", `${RELEASE_ROOT}/README.md`);
};

void prepareReleaseFiles();
