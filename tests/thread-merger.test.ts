import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { mergeThreadsInDirectory } from "../src/services/thread-merger.js";

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

const createDirectory = async (): Promise<string> => {
  const directory = await mkdtemp(path.join(tmpdir(), "undiscord-thread-merger-"));
  tempDirectories.push(directory);
  return directory;
};

const messageContainer = (id: string, text: string): string =>
  `<div id=chatlog__message-container-${id} class=chatlog__message-container data-message-id=${id}><div class=chatlog__message><div class=chatlog__content>${text}</div></div></div>`;

const exportHtml = (
  channelPath: string,
  messageGroups: string,
  chatlogOpen = "<div class=chatlog>"
): string =>
  `<html><head><style>.chatlog{display:block}</style></head><body><div class=preamble__entry>${channelPath}</div>${chatlogOpen}${messageGroups}</div></body></html>`;

const messageGroup = (...messages: string[]): string =>
  `<div class=chatlog__message-group>${messages.join("")}</div>`;

test("merges replies and removes only the duplicated starter message", async () => {
  const directory = await createDirectory();
  const mainFile = "Guild - channel [100].html";
  const threadFile = "Guild - channel - thread [200].html";

  await writeFile(
    path.join(directory, mainFile),
    exportHtml("Guild / channel", messageGroup(messageContainer("200", "starter")))
  );
  await writeFile(
    path.join(directory, threadFile),
    exportHtml(
      "Guild / channel / thread",
      messageGroup(
        messageContainer("200", "starter"),
        messageContainer("201", "first reply")
      ) + messageGroup(messageContainer("202", "second reply"))
    )
  );

  const outputPath = await mergeThreadsInDirectory(directory);
  const merged = await readFile(outputPath, "utf8");

  assert.match(merged, /Thread: thread — 2 messages/);
  assert.equal(
    [...merged.matchAll(/data-message-id=200\b/g)].length,
    1,
    "the starter message should appear only once"
  );
  assert.match(merged, /data-message-id=201\b/);
  assert.match(merged, /data-message-id=202\b/);
});

test("rejects a thread whose parent message is absent from the main export", async () => {
  const directory = await createDirectory();

  await writeFile(
    path.join(directory, "Guild - channel [100].html"),
    exportHtml("Guild / channel", messageGroup(messageContainer("300", "main")))
  );
  await writeFile(
    path.join(directory, "Guild - channel - orphan [200].html"),
    exportHtml(
      "Guild / channel / orphan",
      messageGroup(
        messageContainer("200", "starter"),
        messageContainer("201", "reply")
      )
    )
  );

  await assert.rejects(
    mergeThreadsInDirectory(directory),
    /Parent message 200 .* was not found in the main export/
  );
});

test("rejects non-empty thread exports when the chatlog markup cannot be parsed", async () => {
  const directory = await createDirectory();

  await writeFile(
    path.join(directory, "Guild - channel [100].html"),
    exportHtml("Guild / channel", messageGroup(messageContainer("200", "starter")))
  );
  await writeFile(
    path.join(directory, "Guild - channel - thread [200].html"),
    exportHtml(
      "Guild / channel / thread",
      messageGroup(
        messageContainer("200", "starter"),
        messageContainer("201", "reply")
      ),
      "<div data-template-version=2 class=chatlog>"
    )
  );

  await assert.rejects(
    mergeThreadsInDirectory(directory),
    /Could not extract chatlog content from thread export/
  );
});

test("rejects partial message-group parsing instead of dropping replies", async () => {
  const directory = await createDirectory();

  await writeFile(
    path.join(directory, "Guild - channel [100].html"),
    exportHtml("Guild / channel", messageGroup(messageContainer("200", "starter")))
  );
  await writeFile(
    path.join(directory, "Guild - channel - thread [200].html"),
    exportHtml(
      "Guild / channel / thread",
      messageGroup(messageContainer("200", "starter")) +
        `<div data-template-version=2 class=chatlog__message-group>${messageContainer(
          "201",
          "reply"
        )}</div>`
    )
  );

  await assert.rejects(
    mergeThreadsInDirectory(directory),
    /Could not extract all messages .* missing message IDs: 201/
  );
});
