import preact from "preact";
import { createLink, URLParamStr } from "./URLParam";
export class Anchor extends preact.Component<{
    params: [URLParamStr, string][]
}> {
    render() {
        const { params } = this.props;
        return (
            <a
                href={createLink(params)}
                onClick={e => {
                    e.preventDefault();
                    e.stopPropagation();
                    for (let [param, value] of params) {
                        param.value = value;
                    }
                }}
            >
                {this.props.children}
            </a>
        );
    }
}
