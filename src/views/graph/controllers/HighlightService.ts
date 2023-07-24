import Link from "src/graph/Link";
import Node from "../../../graph/Node";
import { AbstractGraphService } from "./AbstractGraphService";

export class HighlightService extends AbstractGraphService {
	private readonly links: Set<Link> = new Set();
	private readonly nodes: Set<string> = new Set();
    private readonly parents: Set<string> = new Set();

    public update(): void {
        this.instance
			.nodeColor(this.instance.nodeColor())
			.linkColor(this.instance.linkColor())
			.linkDirectionalParticles(this.instance.linkDirectionalParticles());
    }

    public clear(): void {
        this.links.clear();
        this.nodes.clear();
        this.parents.clear();
    }

    public addLink(link: Link): void {
        this.links.add(link);
    }

    public addNode(node: Node): void {
        this.nodes.add(node.id);
    }

    public addParent(id: string): void {
        this.parents.add(id);
    }

	public hasLink(link: Link): boolean {
		return this.links.has(link);
	};

    public hasNode(node: Node): boolean {
        return this.nodes.has(node.id);
    }

    public isParent(node: Node): boolean {
        return this.parents.has(node.id);
    }

    public parentIndex(node: Node): number {
        let keys = this.parents.keys();
        for (let index = 0; index < this.parents.size; index++) {
            let key = keys.next();
            if(key.value === node.id) {
                return index;
            }
        }
        return -1;
    }

    public getLinkSize(): number {
        return this.links.size;
    }

    public getNodeSize(): number {
        return this.nodes.size;
    }

    public getParentSize(): number {
        return this.parents.size;
    }
}