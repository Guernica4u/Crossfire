import Link from "next/link";
import { Compass, Plus } from "lucide-react";
import { EmptyState } from "@/components/ui";

export default function NotFound() {
  return (
    <div className="page page-narrow">
      <div className="page-head">
        <div>
          <div className="eyebrow">404</div>
          <h1 className="page-title">Lost in the arena.</h1>
          <p className="page-sub">
            There is no transcript at this address. The debate may have been deleted, or the
            link is wrong.
          </p>
        </div>
        <Link href="/new" className="button button-primary">
          <Plus size={15} />
          Start a debate
        </Link>
      </div>
      <EmptyState
        icon={<Compass size={20} />}
        title="Nothing at this table"
        copy="Head back to the archive to pick up an existing debate, or set a new question."
        action={
          <Link href="/" className="button">
            Back to the archive
          </Link>
        }
      />
    </div>
  );
}
