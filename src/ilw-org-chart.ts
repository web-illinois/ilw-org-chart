import {
    html,
    LitElement,
    nothing,
    PropertyValues,
    TemplateResult,
    unsafeCSS,
} from "lit";
// @ts-ignore
import "./ilw-org-chart.css";
import { customElement, property, query, state } from "lit/decorators.js";
import { Org } from "./Org";
import {
    calculateLevelOrientations,
    calculateLinesBetweenOrgs,
    ConnectedOrg,
    measureOrgBoxes,
    OrgChartConfig,
    OrgPlacement,
    TreeLevel,
    TreeLevelMap,
    treeLevelOrgs,
} from "./tree";
import { Task } from "@lit/task";
import { classMap } from "lit/directives/class-map.js";
import { styleMap } from "lit/directives/style-map.js";

@customElement("ilw-org-chart")
export default class OrgChart extends LitElement {
    @property()
    theme = "";

    @property()
    org: Org | null = null;

    @property()
    width = "1200";

    @property()
    label = "";

    @query(".ilw-org-chart-canvas")
    canvas!: HTMLCanvasElement;

    /**
     * Set/get the ID of the currently selected org box.
     *
     * This is not a state variable because we don't want to trigger a re-render,
     * updates to this variable are handled manually.
     */
    private _selectedId: number = -1;

    get selectedId(): number {
        return this._selectedId;
    }
    set selectedId(value: number) {
        const oldValue = this._selectedId;
        this._selectedId = value;

        const oldOrg = this.querySelector(`#org-${oldValue}`);
        const newOrg = this.querySelector(`#org-${value}`);

        if (oldOrg && newOrg) {
            oldOrg.setAttribute("aria-selected", "false");
            oldOrg.setAttribute("tabindex", "-1");
            oldOrg.classList.remove("ilw-org-chart-selected");
            newOrg.setAttribute("aria-selected", "true");
            newOrg.setAttribute("tabindex", "0");
            newOrg.classList.add("ilw-org-chart-selected");
            (newOrg as HTMLElement).focus();
        }
    }

    static config: OrgChartConfig = {
        horizontalSpacing: 40,
        availableSpace: 1200,
        largeOrgSizeMultiplier: 1.2,
        verticalChildOffset: 20,
        verticalSpacing: 30,
        verticalSubtreeSpacing: 20,
        maxColWidth: 300,
        minColWidth: 150,
        skipLineExtraSpacing: 80
    };

    _treeTask = new Task(this, {
        task: async ([org]) => {
            if (!org) {
                return null;
            }
            OrgChart.config.availableSpace = parseInt(this.width);
            const tree = treeLevelOrgs(org);
            calculateLevelOrientations(tree, OrgChart.config);
            const measured = measureOrgBoxes(
                tree,
                "ilw-org-chart",
                OrgChart.config,
            );
            const lines = calculateLinesBetweenOrgs(
                tree,
                measured,
                OrgChart.config,
            );
            return {
                tree,
                measured,
                lines,
            };
        },
        args: () => [this.org] as const,
    });

    constructor() {
        super();
    }

    createRenderRoot() {
        return this;
    }

    refreshTask() {
        this._treeTask.run();
    }

    private clickHandler(e: MouseEvent, id: number) {
        this.selectedId = id;
    }

    private setFocusToPreviousSibling(id: number) {
        const org = this._treeTask.value?.tree.findPreviousSibling(id);
        if (org) {
            this.selectedId = org.id;
        }
    }

    private setFocusToNextSibling(id: number) {
        const org = this._treeTask.value?.tree.findNextSibling(id);
        if (org) {
            this.selectedId = org.id;
        }
    }

    private setFocusToParent(id: number) {
        const org = this._treeTask.value?.tree.findParent(id);
        if (org) {
            this.selectedId = org.id;
        }

    }
    private setFocusToChild(id: number) {
        const org = this._treeTask.value?.tree.findFirstChild(id);
        if (org) {
            this.selectedId = org.id;
        }
    }

    private keydownHandler(event: KeyboardEvent, id: number) {
        let tgt = event.currentTarget,
            flag = false,
            key = event.key;

        if (event.altKey || event.ctrlKey || event.metaKey || !this._treeTask.value?.tree.root) {
            return;
        }

        const org = this._treeTask.value.tree.orgLookup.get(id);
        if (!org) {
            console.warn(`Org with ID ${id} not found in keydownHandler.`);
            return;
        }

        const isHorizontal = this._treeTask.value.tree.primaryOrientation === "horizontal";

        switch (key) {
            case 'Up':
            case 'ArrowUp':
                if (isHorizontal) {
                    this.setFocusToParent(id);
                } else {
                    this.setFocusToPreviousSibling(id);
                }
                flag = true;
                break;

            case 'Down':
            case 'ArrowDown':
                if (isHorizontal) {
                    this.setFocusToChild(id);
                } else {
                    this.setFocusToNextSibling(id);
                }
                flag = true;
                break;

            case 'Right':
            case 'ArrowRight':
                if (isHorizontal) {
                    this.setFocusToNextSibling(id);
                } else {
                    this.setFocusToChild(id);
                }
                flag = true;
                break;

            case 'Left':
            case 'ArrowLeft':
                if (isHorizontal) {
                    this.setFocusToPreviousSibling(id);
                } else {
                    this.setFocusToParent(id);
                }
                flag = true;
                break;

            case 'Home':
                this.selectedId = this._treeTask.value?.tree.root?.id;
                flag = true;
                break;

            case 'End':
                const ordered = this._treeTask.value.tree.orderedEntries();
                // Walk back from the highest level to find a level that's not empty
                for (let i = ordered.length - 1; i >= 0; i--) {
                    const level = ordered[i][1];
                    if (level.orgs.length > 0) {
                        this.selectedId = level.orgs[level.orgs.length - 1].id;
                        break;
                    }
                }
                flag = true;
                break;
        }

        if (flag) {
            event.stopPropagation();
            event.preventDefault();
        }
    }

    private renderChildren(
        elementId: string,
        children: ConnectedOrg[],
        placements: Map<number, OrgPlacement>,
    ): TemplateResult {
        return html`<ul id=${elementId} class="org-children" role="group">
            ${children.map((child) => this.renderOrg(child, placements))}
        </ul>`;
    }

    private renderOrg(
        org: ConnectedOrg,
        placements: Map<number, OrgPlacement>,
    ): TemplateResult {
        let placement = placements.get(org.id)!;
        const classes: Record<string, boolean> = {
            "ilw-org-chart": true,
            "ilw-org-chart-large": !!org.large,
        };
        const styles = {
            top: `${placement?.top}px`,
            left: `${placement?.left}px`,
            width: `${placement?.width}px`,
            height: `${placement?.height}px`,
        };
        const isParent = org.children && org.children.length > 0;
        const isSelected = this.selectedId === org.id;
        if (isSelected) {
            classes["ilw-org-chart-selected"] = true;
        }
        return html`
            <li class="org-container" role="none">
                <a
                    id="org-${org.id}"
                    role="treeitem"
                    aria-expanded=${isParent ? "true" : nothing}
                    aria-selected=${isSelected ? "true" : "false"}
                    tabindex=${isSelected ? "0" : "-1"}
                    @click=${(e: MouseEvent) => this.clickHandler(e, org.id)}
                    @keydown=${(e: KeyboardEvent) => this.keydownHandler(e, org.id)}
                    class=${classMap(classes)} style=${styleMap(styles)}
                    aria-owns=${isParent ? `org-children-${org.id}` : nothing}
                    href="#org-${org.id}"
                >
                    <span class="org-title">${org.title}</span>
                    <span class="org-subtitle">${org.subtitle}</span>
                </a>
                ${
                    org.children && org.children.length > 0
                        ? this.renderChildren(`org-children-${org.id}`, org.children, placements)
                        : ""
                }
            </li>`;
    }

    render() {
        if (this._treeTask.value?.tree?.root) {
            if (this.selectedId === -1) {
                this.selectedId = this._treeTask.value.tree.root.id;
            }
            let height = 0;
            for (const placement of this._treeTask.value.measured.values()) {
                height = Math.max(height, placement.top + placement.height);
            }
            let primaryOrientation = this._treeTask.value.tree.primaryOrientation;
            return html`<div
                class="ilw-org-chart-container"
                style="width: ${this.width}px; height: ${height + 20}px;"
            >
                <canvas
                    class="ilw-org-chart-canvas"
                    width=${this.width}
                    height=${height + 20}
                ></canvas>
                <ul class="ilw-org-chart-top ${this.theme}" aria-label=${this.label} role="tree" aria-orientation="${primaryOrientation}">
                    ${this._treeTask.value
                        ? this.renderOrg(
                              this._treeTask.value.tree.root,
                              this._treeTask.value.measured,
                          )
                        : ""}
                </ul>
            </div>`;
        } else {
            return html`<div>No organization data provided.</div>`;
        }
    }

    protected updated(_changedProperties: PropertyValues): void {
        super.updated(_changedProperties);

        const ctx = this.canvas?.getContext("2d");
        if (ctx) {
            ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
            ctx.strokeStyle = this.theme == '' || this.theme == 'white' ? "#000000" : "#ffffff";
            ctx.lineWidth = 4;

            if (this._treeTask.value?.lines) {
                for (const line of this._treeTask.value.lines) {
                    ctx.beginPath();
                    let start = line.points[0];
                    ctx.moveTo(start.x, start.y);
                    for (let i = 1; i < line.points.length; i++) {
                        const point = line.points[i];
                        ctx.lineTo(point.x, point.y);
                    }
                    ctx.lineJoin = "round";
                    
                    ctx.stroke();
                }
            }
        }
    }
}

declare global {
    interface HTMLElementTagNameMap {
        "ilw-org-chart": OrgChart;
    }
}
