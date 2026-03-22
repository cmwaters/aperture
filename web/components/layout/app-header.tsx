import Link from "next/link";

interface Props {
  teamSlug: string;
}

export function AppHeader({ teamSlug }: Props) {
  return (
    <header className="border-b border-neutral-100 bg-white">
      <div className="max-w-3xl mx-auto px-6 h-14 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <Link href={`/${teamSlug}`} className="flex items-center gap-2">
            <div className="h-5 w-5 rounded-full bg-neutral-900" />
            <span className="text-sm font-semibold tracking-tight">Aperture</span>
          </Link>
          <nav className="flex items-center gap-1">
            <Link
              href={`/${teamSlug}`}
              className="px-3 py-1.5 rounded-md text-sm text-neutral-900 font-medium bg-neutral-100"
            >
              Queue
            </Link>
          </nav>
        </div>
      </div>
    </header>
  );
}
