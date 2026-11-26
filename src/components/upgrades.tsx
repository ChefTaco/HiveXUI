import { productEnabled } from "../lib/runtime";
import { useState } from "react";
import { Button, Panel } from "./ui";

/**
 * Suite lifecycle runs on the installation controller. The console's own upgrade flow, with its
 * password confirmation through Emberpath, is retired: HiveXUI never handles a password for a product.
 */
export function UpgradesPanel(_props: { canUpgrade: boolean }) {
  return <SuiteLifecyclePanel />;
}
function SuiteLifecyclePanel() {
  const [workflow, setWorkflow] = useState<"inspect" | "upgrade" | "recover">(
    "inspect",
  );
  const [message, setMessage] = useState("");
  const steps = {
    inspect: [
      [
        "Read installation health",
        "./hive.sh status --config installation.json",
      ],
      [
        "Check hosts and configuration",
        "./hive.sh doctor --config installation.json",
      ],
    ],
    upgrade: [
      [
        "Review the exact signed release",
        "./hive.sh plan --config installation.json --release VERSION",
      ],
      [
        "Create and verify a backup",
        "./hive.sh backup --config installation.json",
      ],
      [
        "Rehearse the backup in isolation",
        "./hive.sh rehearse --config installation.json --archive BACKUP_ID",
      ],
      [
        "Activate during the maintenance window",
        "./hive.sh upgrade --config installation.json --release VERSION",
      ],
      [
        "Check the activated installation",
        "./hive.sh doctor --config installation.json",
      ],
    ],
    recover: [
      [
        "Use binary rollback only with compatible storage",
        "./hive.sh rollback --config installation.json --release PREVIOUS_VERSION",
      ],
      [
        "For data recovery, review writes since the chosen backup",
        "./hive.sh restore --config installation.json --archive BACKUP_ID --reconciliation reconciliation.json",
      ],
      [
        "Check the recovered installation",
        "./hive.sh doctor --config installation.json",
      ],
    ],
  } satisfies Record<string, string[][]>;
  return (
    <Panel title="Hive lifecycle" eyebrow="Installation controller">
      <p>
        Run these steps on the installation control host with its protected
        configuration. Replace the release and backup placeholders with the
        reviewed values.
      </p>
      <div className="flex gap-2 flex-wrap">
        {(["inspect", "upgrade", "recover"] as const).map((value) => (
          <Button
            key={value}
            variant="default"
            aria-pressed={workflow === value}
            onClick={() => {
              setWorkflow(value);
              setMessage("");
            }}
          >
            {value === "inspect"
              ? "Health"
              : value === "upgrade"
                ? "Upgrade"
                : "Recovery"}
          </Button>
        ))}
      </div>
      <ol>
        {steps[workflow].map(([label, command]) => (
          <li key={command}>
            <p>{label}</p>
            <pre className="code-block">
              <code>{command}</code>
            </pre>
            <Button
              variant="default"
              onClick={() => {
                if (command)
                  void navigator.clipboard
                    .writeText(command)
                    .then(() => setMessage("Command copied"))
                    .catch(() => setMessage("Select the command to copy it"));
              }}
            >
              Copy command
            </Button>
          </li>
        ))}
      </ol>
      {workflow === "upgrade" && (
        <p>
          Use a tested signed release and a rehearsed backup before activation.
          Any migration requiring approval remains explicit; automatic upgrades
          stay disabled.
        </p>
      )}
      {workflow === "recover" && (
        <p>
          Restore requires a protected reconciliation file acknowledging
          subsequent writes. Reuse the installation's rehearsed recovery
          procedure and keep one active writer.
        </p>
      )}
      {productEnabled("magnus") && (
        <p>
          <a href="/fleet">Open Magnus</a>{" "}
          for approved fleet jobs. A suite lifecycle job adapter is not
          configured; these commands remain the available workflow.
        </p>
      )}
      <p role="status">{message}</p>
    </Panel>
  );
}
