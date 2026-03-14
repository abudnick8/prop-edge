import { Link } from "wouter";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
      <p className="text-5xl font-bold font-mono text-primary mb-3">404</p>
      <p className="text-lg font-semibold text-foreground mb-2">Page Not Found</p>
      <p className="text-sm text-muted-foreground mb-6">This page doesn't exist.</p>
      <Link href="/">
        <a className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-semibold hover:bg-primary/90 transition-colors">
          Go to Dashboard
        </a>
      </Link>
    </div>
  );
}
