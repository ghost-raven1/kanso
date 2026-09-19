/** An independent widget communicates with its host through ordinary props. */
export default function Banner(props: {
    message: string;
    onDismiss?: () => void;
}): import("solid-js").JSX.Element;
