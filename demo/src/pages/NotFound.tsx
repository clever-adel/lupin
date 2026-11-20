import { Link } from "react-router-dom";

export default function NotFound() {
  return (
    <div className="page wrap narrow center notfound">
      <span className="mission-num" aria-hidden>404</span>
      <h1 className="h1">This page <em>vanished.</em></h1>
      <p className="muted">No trace, no fingerprints. Let's get you back.</p>
      <Link to="/" className="btn btn-dark">Back to home</Link>
    </div>
  );
}
