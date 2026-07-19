// Renders a JSON-LD structured-data block. The `<` escape prevents a crafted
// string from closing the script tag (standard JSON-LD XSS hygiene).
export function JsonLd({ data }: { data: object }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, '\\u003c') }}
    />
  );
}
