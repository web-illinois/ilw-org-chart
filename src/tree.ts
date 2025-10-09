import { Org } from "./Org";

/**
 * Org from user input with additional properties for tree rendering.
 */
export interface ConnectedOrg extends Org {
    id: number;
    parent?: ConnectedOrg;
    level: number;
    children?: ConnectedOrg[];
    /**
     * Original index among siblings, used for stable sorting.
     */
    originalIndex: number;
    /**
     * If the line to a child org skips levels, how many levels are skipped.
     *
     * This is so we can place these orgs on the edges so the lines don't cross
     * other org boxes.
     */
    lineSkipsLevels?: number;
}

/**
 * Placement and size of an org box in the chart.
 */
export type OrgPlacement = {
    width: number;
    height: number;
    top: number;
    left?: number;
};

/**
 * Points for a line connecting two orgs.
 */
export type OrgLine = {
    points: { x: number; y: number }[];
};

/**
 * Configuration for rendering the org chart.
 */
export type OrgChartConfig = {
    horizontalSpacing: number;
    verticalSpacing: number;
    verticalSubtreeSpacing: number;
    verticalChildOffset: number;
    largeOrgSizeMultiplier: number;
    availableSpace: number;
    minColWidth: number;
    maxColWidth: number;
    skipLineExtraSpacing: number;
};

/**
 * Orgs grouped by their level in the tree.
 */
export class TreeLevel {
    level: number;
    orgs: ConnectedOrg[];
    orientation?: "horizontal" | "vertical";
    rightSkipLine: boolean = false;
    leftSkipLine: boolean = false;
    /**
     * Array of empty space intervals for this level, as { start, end } in px.
     */
    emptySpaces: { start: number; end: number }[] = [];
    constructor(level: number, orgs: ConnectedOrg[]) {
        this.level = level;
        this.orgs = orgs;
    }
}

/**
 * Map of tree levels to their orgs, with helper methods.
 */
export class TreeLevelMap extends Map<number, TreeLevel> {
    root: ConnectedOrg | null = null;
    primaryOrientation: "horizontal" | "vertical" = "horizontal";
    orgLookup: Map<number, ConnectedOrg> = new Map();

    orderedEntries() {
        return Array.from(this.entries()).sort((a, b) => a[0] - b[0]);
    }

    findParent(orgId: number): ConnectedOrg | null {
        const org = this.orgLookup.get(orgId);
        return org?.parent || null;
    }

    findNextSibling(orgId: number): ConnectedOrg | null {
        const org = this.orgLookup.get(orgId);
        if (!org || !org.parent){
            return null;
        }

        const siblings = org.parent.children;

        if (!siblings) {
            return null;
        }

        const index = siblings.findIndex((o) => o.id === orgId);
        if (index >= 0 && index < siblings.length - 1) {
            return siblings[index + 1];
        }
        return null;
    }

    findPreviousSibling(orgId: number): ConnectedOrg | null {
        const org = this.orgLookup.get(orgId);
        if (!org || !org.parent){
            return null;

        }
        const siblings = org.parent.children;
        if (!siblings) {
            return null;
        }
        const index = siblings.findIndex((o) => o.id === orgId);
        if (index > 0) {
            return siblings[index - 1];
        }
        return null;
    }

    findFirstChild(orgId: number): ConnectedOrg | null {
        const org = this.orgLookup.get(orgId);
        if (!org || !org.children || org.children.length === 0) {
            return null;
        }
        return org.children[0];
    }
}

/**
 * Unique ID generator for ConnectedOrgs.
 */
let orgIdCount = 1;

/**
 * Place orgs to horizontal levels based on their hierarchy and weights.
 *
 * Root is always in level 0, and ascending levels go down from there.
 * Two children of the root can stay in level 0 if they have weight -1.
 *
 * @param org The root org
 */
export function treeLevelOrgs(org: Org): TreeLevelMap {
    const levelOrgs = new TreeLevelMap();

    function traverse(
        node: Org,
        parent: ConnectedOrg | null,
        currentLevel: number,
        originalIndex: number = 0,
    ): ConnectedOrg {
        const level = currentLevel + (node.weight ?? 0);
        const connectedNode = {
            ...node,
            id: orgIdCount++,
            parent: parent as ConnectedOrg,
            level,
            originalIndex,
        } as ConnectedOrg;

        if (!levelOrgs.has(level)) {
            levelOrgs.set(level, new TreeLevel(level, []));
        }
        levelOrgs.get(level)!.orgs.push(connectedNode);
        levelOrgs.orgLookup.set(connectedNode.id, connectedNode);

        // Replace children with ConnectedOrgs
        if (node.children) {
            const connectedChildren: ConnectedOrg[] = [];
            for (let i = 0; i < node.children.length; i++) {
                const child = node.children[i];
                const connectedChild = traverse(
                    child,
                    connectedNode,
                    level + 1,
                    i,
                );
                connectedChildren.push(connectedChild);
                if (connectedChild.level > level + 1) {
                    connectedNode.lineSkipsLevels =
                        connectedChild.level - (level + 1);
                }
            }
            connectedNode.children = connectedChildren;
        }
        return connectedNode;
    }

    levelOrgs.root = traverse(org, null, 0);

    // Top level can have at most three orgs: root and two children
    if (levelOrgs.get(0) && levelOrgs.get(0)!.orgs.length > 3) {
        let treeLevel = levelOrgs.get(0)!;

        const keep = treeLevel.orgs.slice(0, 3);
        const demotedOrgs = treeLevel.orgs.slice(3);
        treeLevel.orgs = keep;

        // Demote extra children to next level
        if (!levelOrgs.has(1)) {
            levelOrgs.set(1, new TreeLevel(1, []));
        }
        const nextLevel = levelOrgs.get(1)!;
        for (const demoted of demotedOrgs) {
            demoted.level = 1;
            nextLevel.orgs.push(demoted);
        }
    }

    return levelOrgs;
}

/**
 * Calculate the orientation (horizontal/vertical) for each level in the org chart.
 *
 * A level is horizontal if all its orgs can fit within availableSpace
 * given minColWidth. If any org in a level is vertical, all its descendant
 * levels must also be vertical.
 */
export function calculateLevelOrientations(
    levels: TreeLevelMap,
    config: OrgChartConfig,
) {
    // First pass: assign initial orientations
    for (const [level, treeLevel] of levels.entries()) {
        const requiredWidth = (treeLevel.orgs.length || 1) * config.minColWidth;
        if (config.minColWidth <= 0 || config.maxColWidth <= 0) {
            treeLevel.orientation = "vertical";
        } else if (requiredWidth <= config.availableSpace) {
            treeLevel.orientation = "horizontal";
        } else {
            treeLevel.orientation = "vertical";
        }
    }

    // Second pass: propagate vertical orientation to descendant levels
    const visited = new Set<number>();
    function propagateVertical(level: number) {
        if (visited.has(level)) return;
        visited.add(level);
        const treeLevel = levels.get(level);
        if (!treeLevel) return;
        treeLevel.orientation = "vertical";
        treeLevel.leftSkipLine = false;
        treeLevel.rightSkipLine = false;
        for (const org of treeLevel.orgs) {
            org.lineSkipsLevels = undefined;
            if (org.children && org.children.length > 0) {
                for (const child of org.children) {
                    if (child.level !== undefined) {
                        propagateVertical(child.level);
                    }
                }
            }
        }
    }
    for (const [level, treeLevel] of levels.entries()) {
        if (treeLevel.orientation === "vertical") {
            propagateVertical(level);
        }
    }

    // Third pass: remove effects of weight for any levels below a vertical level
    const orgsToMove: {
        org: ConnectedOrg;
        fromLevel: number;
        toLevel: number;
    }[] = [];

    for (const [level, treeLevel] of levels.entries()) {
        if (treeLevel.orientation === "vertical") {
            for (const org of treeLevel.orgs) {
                let newLevel = level;
                if (org.parent && typeof org.parent.level === "number") {
                    newLevel = org.parent.level + 1;
                }
                // Only move if the new level is vertical as well
                if (
                    org.level !== newLevel &&
                    levels.get(newLevel)?.orientation === "vertical"
                ) {
                    orgsToMove.push({
                        org,
                        fromLevel: level,
                        toLevel: newLevel,
                    });
                    org.level = newLevel;
                }
            }
        }
    }
    // Move orgs in the TreeLevelMap, then sort by originalIndex
    for (const { org, fromLevel, toLevel } of orgsToMove) {
        const fromTreeLevel = levels.get(fromLevel);
        if (fromTreeLevel) {
            fromTreeLevel.orgs = fromTreeLevel.orgs.filter(
                (o) => o.id !== org.id,
            );
        }
        if (!levels.has(toLevel)) {
            levels.set(toLevel, new TreeLevel(toLevel, []));
        }
        levels.get(toLevel)!.orgs.push(org);
    }
    // Sort orgs in each level by originalIndex
    for (const [, treeLevel] of levels.entries()) {
        treeLevel.orgs.sort((a, b) => {
            if (a.originalIndex === undefined && b.originalIndex === undefined)
                return 0;
            if (a.originalIndex === undefined) return 1;
            if (b.originalIndex === undefined) return -1;
            return a.originalIndex - b.originalIndex;
        });

        // If one or more orgs in a horizontal level has lineSkipsLevels, move those to edges
        if (treeLevel.orientation === "horizontal") {
            let skippingOrgs = treeLevel.orgs.filter(
                (o) => o.lineSkipsLevels && o.lineSkipsLevels > 0,
            );
            if (skippingOrgs.length > 0) {
                let leftEdge: ConnectedOrg | null = skippingOrgs[0];
                let rightEdge: ConnectedOrg | null =
                    skippingOrgs[skippingOrgs.length - 1];
                if (treeLevel.level > 0) {
                    skippingOrgs = skippingOrgs.slice(0, 2); // only two can be moved to edges
                    // Move skipping orgs to the edges
                    rightEdge = skippingOrgs[0];
                    treeLevel.orgs = treeLevel.orgs.filter(
                        (o) => !skippingOrgs.includes(o),
                    );
                    treeLevel.orgs.push(rightEdge);

                    if (skippingOrgs.length > 1) {
                        leftEdge = skippingOrgs[1];
                        treeLevel.orgs.unshift(leftEdge);
                    } else {
                        leftEdge = null;
                    }
                } else {
                    // We don't move the root, and only root can have edge skipping on top level
                    // We also want to check that the root is actually close to the edge, and not
                    // in the middle somewhere.
                    const topLevelSize =
                        levels.get(0)!.orgs.length *
                        (config.maxColWidth + config.horizontalSpacing);
                    const rootFarFromLeft =
                        leftEdge === levels.root &&
                        config.availableSpace > topLevelSize;
                    const rootFarFromRight =
                        rightEdge === levels.root &&
                        config.availableSpace > topLevelSize;

                    if (leftEdge !== levels.root || rootFarFromLeft) {
                        leftEdge = null;
                    }
                    if (rightEdge !== levels.root || rootFarFromRight) {
                        rightEdge = null;
                    }
                }

                if (rightEdge) {
                    for (let i = 1; i <= rightEdge.lineSkipsLevels!; i++) {
                        levels.get(treeLevel.level + i)!.rightSkipLine = true;
                    }
                }

                if (leftEdge) {
                    for (let i = 1; i <= leftEdge.lineSkipsLevels!; i++) {
                        levels.get(treeLevel.level + i)!.leftSkipLine = true;
                    }
                }
            }
        }
    }

    // If all but the top level are vertical, set primaryOrientation to vertical
    let allButTopVertical = true;
    for (const [level, treeLevel] of levels.entries()) {
        if (level === 0) continue;
        if (treeLevel.orientation !== "vertical") {
            allButTopVertical = false;
            break;
        }
    }
    if (allButTopVertical) {
        levels.primaryOrientation = "vertical";
    }
}

/**
 * Measure the rendered sizes and vertical positions of org boxes in the tree.
 *
 * This function uses the browser's inherent layout engine to measure the sizes
 * and vertical placement by placing the orgs based on their vertical level. With a
 * few CSS rules this correctly handles text wrapping, font sizes, padding, etc.
 *
 * Horizontal placement is calculated separately after measuring because it's not
 * possible to do with pure CSS.
 *
 * The CSS class is applied so that style changes will get reflected correctly.
 */
export function measureOrgBoxes(
    levelsMap: TreeLevelMap,
    cssClass: string,
    config: OrgChartConfig,
) {
    console.log("[measureOrgBoxes] Start measuring org boxes", levelsMap);
    const startTime = performance.now();

    // Create hidden container
    const container = document.createElement("div");
    const hiddenTopOffset = -9999;
    container.style.position = "absolute";
    container.style.background = "#111";
    container.style.visibility = "hidden";
    container.style.pointerEvents = "none";
    container.style.left = "-9999px";
    container.style.top = hiddenTopOffset + "px";
    document.body.appendChild(container);

    // Track measurements by org ID
    const orgSizes = new Map<number, OrgPlacement>();

    // Helper to recursively render vertical sub-tree
    function renderVerticalSubtree(
        org: ConnectedOrg,
        parent: HTMLDivElement,
        offset = 0,
    ): HTMLElement {
        const orgContainer = document.createElement("div");
        orgContainer.className = cssClass + " " + cssClass + "-vertical-org";
        if (org.large) {
            orgContainer.className += " " + cssClass + "-large";
        }
        // Offset subsequent vertical levels to the right
        orgContainer.style.marginLeft = offset + "px";
        orgContainer.style.boxSizing = "border-box";
        orgContainer.style.width = "calc(100% - " + offset + "px)";
        const titleDiv = document.createElement("div");
        titleDiv.className = cssClass + "-title";
        titleDiv.textContent = org.title;
        orgContainer.appendChild(titleDiv);
        if (org.subtitle) {
            const subtitleDiv = document.createElement("div");
            subtitleDiv.className = cssClass + "-subtitle";
            subtitleDiv.textContent = org.subtitle || "";
            orgContainer.appendChild(subtitleDiv);
        }
        parent.appendChild(orgContainer);
        if (org.children && org.children.length > 0) {
            for (const child of org.children) {
                renderVerticalSubtree(
                    child as ConnectedOrg,
                    parent,
                    offset + config.verticalChildOffset,
                );
            }
        }

        const rect = orgContainer.getBoundingClientRect();

        // Left is calculated in a separate function
        orgSizes.set(org.id, {
            width: rect.width,
            height: rect.height,
            top: rect.top - hiddenTopOffset,
        });

        return orgContainer;
    }

    let maxLevel = Math.max(...Array.from(levelsMap.keys()));

    // Any levels with children of vertical levels must also be vertical,
    // so this is set on the first vertical level found and reset on the next
    // horizontal level
    let firstVerticalLevel: number | null = null;

    for (let level = 0; level <= maxLevel; level++) {
        const treeLevel = levelsMap.get(level);
        if (!treeLevel) continue;

        if (treeLevel.orientation === "horizontal") {
            let realAvailableSpace = config.availableSpace;
            if (treeLevel.rightSkipLine) {
                realAvailableSpace -= config.skipLineExtraSpacing;
            }
            if (treeLevel.leftSkipLine) {
                realAvailableSpace -= config.skipLineExtraSpacing;
            }
            firstVerticalLevel = null;
            const levelContainer = document.createElement("div");
            levelContainer.className =
                cssClass + "-level " + cssClass + "-horizontal";
            levelContainer.style.columnGap = config.horizontalSpacing + "px";
            levelContainer.style.marginBottom = config.verticalSpacing + "px";

            const largeOrgs = treeLevel.orgs.filter((org) => org.large);
            const smallOrgs = treeLevel.orgs.filter((org) => !org.large);

            // Divide the space so that large orgs get a bit more space
            const totalUnits =
                largeOrgs.length * config.largeOrgSizeMultiplier +
                smallOrgs.length;
            const unitWidth =
                (realAvailableSpace -
                    (totalUnits - 1) * config.horizontalSpacing) /
                totalUnits;
            const largeOrgWidth = Math.min(
                Math.max(
                    unitWidth * config.largeOrgSizeMultiplier,
                    config.minColWidth * config.largeOrgSizeMultiplier,
                ),
                config.maxColWidth * config.largeOrgSizeMultiplier,
            );
            let smallOrgWidth = Math.min(
                Math.max(unitWidth * 1.0, config.minColWidth),
                config.maxColWidth,
            );
            console.log("totalUnits, unitWidth, largeOrgWidth, smallOrgWidth", totalUnits, unitWidth, largeOrgWidth, smallOrgWidth);

            levelContainer.style.width = realAvailableSpace + "px";
            container.appendChild(levelContainer);

            // Keep track of the elements because we want to measure them only
            // after all have been added to the DOM
            const els = new Map<number, HTMLDivElement>();

            for (const org of treeLevel.orgs) {
                const el = document.createElement("div");
                el.className = cssClass;
                if (org.large) {
                    el.className += " " + cssClass + "-large";
                }
                el.style.width = org.large
                    ? largeOrgWidth + "px"
                    : smallOrgWidth + "px";

                const titleDiv = document.createElement("div");
                titleDiv.className = cssClass + "-title";
                titleDiv.textContent = org.title;
                el.appendChild(titleDiv);
                if (org.subtitle) {
                    const subtitleDiv = document.createElement("div");
                    subtitleDiv.className = cssClass + "-subtitle";
                    subtitleDiv.textContent = org.subtitle || "";
                    el.appendChild(subtitleDiv);
                }
                levelContainer.appendChild(el);
                els.set(org.id, el);
            }

            let maxHeight = 0;
            for (const [id, el] of els) {
                const rect = el.getBoundingClientRect();

                // Left is calculated in a separate function
                orgSizes.set(id, {
                    width: rect.width,
                    height: rect.height,
                    top: rect.top - hiddenTopOffset,
                });
                maxHeight = Math.max(maxHeight, rect.height);
            }
            if (smallOrgs.length === 0 || largeOrgs.length === 0) {
                // If all orgs are of the same size, make them all the same height
                for (const org of treeLevel.orgs) {
                    const p = orgSizes.get(org.id);
                    if (p) {
                        const diff = maxHeight - p.height;
                        p.height = maxHeight;
                        p.top -= diff / 2; // center vertically
                    }
                }
            }
        } else if (
            firstVerticalLevel === null &&
            treeLevel.orientation === "vertical"
        ) {
            firstVerticalLevel = level;
            const verticalContainer = document.createElement("div");
            verticalContainer.className =
                cssClass + "-level " + cssClass + "-vertical";
            verticalContainer.style.width = config.availableSpace + "px";
            container.appendChild(verticalContainer);

            // Find all the unique parents of this level's orgs, we need to
            // make sure the vertical subtree isn't wider than the parent org box.
            // This doesn't necessarily have to always be the case, but it's simpler
            // for now.
            const uniqueParents = new Set<ConnectedOrg>();
            for (const org of treeLevel.orgs) {
                if (org.parent) {
                    uniqueParents.add(org.parent);
                }
            }
            for (const org of uniqueParents) {
                const subtreeContainer = document.createElement("div");
                subtreeContainer.className = cssClass + "-vertical-subtree";
                const width = orgSizes.get(org.id)!.width;
                subtreeContainer.style.width =
                    width - config.verticalChildOffset + "px";
                subtreeContainer.style.gap =
                    config.verticalSubtreeSpacing + "px";
                verticalContainer.appendChild(subtreeContainer);
                for (const child of org.children || []) {
                    if (child.level && child.level >= level) {
                        renderVerticalSubtree(
                            child,
                            subtreeContainer,
                            config.verticalChildOffset,
                        );
                    }
                }
            }
        } else {
            // skip levels that are descendants of the first vertical level
        }
    }

    const updated = calculateHorizontalPositions(levelsMap, orgSizes, config);
    document.body.removeChild(container);
    const endTime = performance.now();
    const duration = endTime - startTime;
    console.log(
        `[measureOrgBoxes] Finished measuring. Duration: ${duration.toFixed(2)} ms`,
        orgSizes,
    );
    console.log("[measureOrgBoxes] Measured org sizes:", orgSizes);
    console.log("[measureOrgBoxes] Updated placements:", updated);

    return orgSizes;
}

/**
 * Calculate the horizontal positions (left) of org boxes in the chart.
 *
 * This is run after the measureOrgBoxes function, and is the final step
 * in laying out the org chart.
 */
export function calculateHorizontalPositions(
    levelsMap: TreeLevelMap,
    placements: Map<number, OrgPlacement>,
    config: OrgChartConfig,
) {
    // Helper to center an org in available space
    function centerOrg(orgId: number, containerWidth: number) {
        const placement = placements.get(orgId);
        if (!placement) return 0;
        return Math.max(0, (containerWidth - placement.width) / 2);
    }

    // Recursively apply left positions for vertical levels
    function applyVerticalLeft(orgs: ConnectedOrg[], left: number) {
        for (const org of orgs) {
            const placement = placements.get(org.id);
            if (placement) {
                placement.left = left;
            }
            if (org.children && org.children.length > 0) {
                applyVerticalLeft(
                    org.children,
                    left + config.verticalChildOffset,
                );
            }
        }
    }

    // Helper to shift a list of orgs by a certain amount
    function shiftOrgs(orgs: ConnectedOrg[] | undefined, shift: number) {
        if (!orgs) return;
        for (const org of orgs) {
            const placement = placements.get(org.id);
            if (placement && placement.left !== undefined) {
                placement.left += shift;
            }
        }
    }

    if (!levelsMap.root) return;
    const rootLevel = levelsMap.root.level ?? 0;
    const topLevel = levelsMap.get(rootLevel);
    if (!topLevel) return;

    const topOrgs = topLevel.orgs;
    if (topOrgs.length === 0) return;

    const rootOrg = topOrgs[0];
    const rootPlacement = placements.get(rootOrg.id);
    if (!rootPlacement) return;

    // Only the root and at most two children can be in the top level,
    // so calculate their placements first

    // Start by centering the root org and then place the two children to
    // either side
    let rootLeft = centerOrg(rootOrg.id, config.availableSpace);

    let lefts: number[] = [];
    lefts[0] = rootLeft;
    if (topOrgs.length > 1) {
        const p = placements.get(topOrgs[1].id);
        if (p) {
            lefts[1] =
                rootLeft + rootPlacement.width + config.horizontalSpacing;
        }
    }
    if (topOrgs.length > 2) {
        const p = placements.get(topOrgs[2].id);
        if (p) {
            lefts[2] = rootLeft - (p.width + config.horizontalSpacing);
        }
    }

    let minLeft = Math.min(...lefts.filter((x) => x !== undefined));
    let maxRight = Math.max(
        ...topOrgs.map((org, i) => {
            const p = placements.get(org.id);
            return p && lefts[i] !== undefined ? lefts[i] + p.width : 0;
        }),
    );
    // Make sure the top level orgs aren't outside availableSpace
    let shift = 0;
    if (minLeft < 0) {
        shift = -minLeft;
    } else if (maxRight > config.availableSpace) {
        shift = config.availableSpace - maxRight;
    }
    rootPlacement.left = lefts[0] + shift;
    if (topOrgs.length > 1) {
        const p = placements.get(topOrgs[1].id);
        if (p && lefts[1] !== undefined) {
            p.left = lefts[1] + shift;
        }
    }
    if (topOrgs.length > 2) {
        const p = placements.get(topOrgs[2].id);
        if (p && lefts[2] !== undefined) {
            p.left = lefts[2] + shift;
        }
    }

    // Record empty spaces for the top level
    const orgsWithPlacement = topOrgs
        .map((org, i) => {
            const p = placements.get(org.id);
            return p && p.left !== undefined
                ? { left: p.left, right: p.left + p.width }
                : null;
        })
        .filter(Boolean) as { left: number; right: number }[];
    orgsWithPlacement.sort((a, b) => a.left - b.left);
    const emptySpaces: { start: number; end: number }[] = [];
    let prevRight = 0;
    for (const org of orgsWithPlacement) {
        if (org.left > prevRight + 1) {
            emptySpaces.push({ start: prevRight, end: org.left });
        }
        prevRight = org.right;
    }
    if (prevRight < config.availableSpace) {
        emptySpaces.push({ start: prevRight, end: config.availableSpace });
    }
    topLevel.emptySpaces = emptySpaces;

    let skipVerticalLevels = false;
    for (const [level, treeLevel] of levelsMap.orderedEntries()) {
        // Root level is already placed
        if (level === rootLevel) continue;

        // Skip remaining vertical levels until we find a horizontal level
        if (skipVerticalLevels) {
            if (treeLevel.orientation === "horizontal") {
                skipVerticalLevels = false;
            } else {
                continue;
            }
        }

        if (treeLevel.orientation === "horizontal") {
            // First group the orgs in the level by their parent so we can
            // center them below the parent.
            const parentGroups = new Map<number, ConnectedOrg[]>();
            let realAvailableSpace = config.availableSpace;
            if (treeLevel.rightSkipLine) {
                realAvailableSpace -= config.skipLineExtraSpacing;
            }
            if (treeLevel.leftSkipLine) {
                realAvailableSpace -= config.skipLineExtraSpacing;
            }

            for (const org of treeLevel.orgs) {
                if (org.parent) {
                    const pid = org.parent.id;
                    if (!parentGroups.has(pid)) parentGroups.set(pid, []);
                    parentGroups.get(pid)!.push(org);
                }
            }
            const groupBounds: { left: number; right: number; pid: number }[] =
                [];
            for (const [pid, group] of parentGroups.entries()) {
                let totalWidth = 0;
                for (const org of group) {
                    const p = placements.get(org.id);
                    if (p) totalWidth += p.width;
                }
                totalWidth += config.horizontalSpacing * (group.length - 1);
                const parentPlacement = placements.get(pid);
                let groupLeft =
                    parentPlacement && parentPlacement.left !== undefined
                        ? parentPlacement.left +
                          (parentPlacement.width - totalWidth) / 2
                        : centerOrg(group[0].id, realAvailableSpace);
                if (groupLeft < 0) groupLeft = 0;
                if (groupLeft + totalWidth > realAvailableSpace)
                    groupLeft = realAvailableSpace - totalWidth;
                let offset = groupLeft;
                for (const org of group) {
                    const p = placements.get(org.id);
                    if (p) {
                        p.left = offset;
                        offset += p.width + config.horizontalSpacing;
                    }
                }
                groupBounds.push({
                    pid,
                    left: groupLeft,
                    right: groupLeft + totalWidth,
                });
            }
            // Next make sure the groups aren't overlapping each other
            groupBounds.sort((a, b) => a.left - b.left);
            let totalOverlap = 0;
            for (let i = 1; i < groupBounds.length; i++) {
                const prev = groupBounds[i - 1];
                const curr = groupBounds[i];
                if (prev.right + config.horizontalSpacing > curr.left) {
                    const overlap =
                        prev.right + config.horizontalSpacing - curr.left;
                    totalOverlap += overlap;
                }
            }
            if (totalOverlap > 0) {
                // Shift the first and last groups outwards to make space
                const first = groupBounds[0];
                const last = groupBounds[groupBounds.length - 1];
                let shiftAmount = totalOverlap / 2;
                first.left -= shiftAmount;
                first.right -= shiftAmount;
                last.left += shiftAmount;
                last.right += shiftAmount;
                shiftOrgs(parentGroups.get(first.pid), -shiftAmount);
                shiftOrgs(parentGroups.get(last.pid), shiftAmount);
            }

            // Finally make sure we're not outside the bounds of availableSpace
            let overallMinLeft = Math.min(...groupBounds.map((gb) => gb.left));
            let overallMaxRight = Math.max(
                ...groupBounds.map((gb) => gb.right),
            );
            let leftBound = treeLevel.leftSkipLine
                ? config.skipLineExtraSpacing
                : 0;
            let rightBound = realAvailableSpace + leftBound;
            let overallShift = 0;
            if (overallMinLeft < leftBound) {
                overallShift = leftBound - overallMinLeft;
            } else if (overallMaxRight > rightBound) {
                overallShift = rightBound - overallMaxRight;
            }
            if (overallShift !== 0) {
                for (const val of parentGroups.values()) {
                    shiftOrgs(val, overallShift);
                }
            }

            // Record empty spaces for this horizontal level
            const orgsWithPlacement = treeLevel.orgs
                .map((org) => {
                    const p = placements.get(org.id);
                    return p && p.left !== undefined
                        ? { left: p.left, right: p.left + p.width }
                        : null;
                })
                .filter(Boolean) as { left: number; right: number }[];
            orgsWithPlacement.sort((a, b) => a.left - b.left);
            const emptySpaces: { start: number; end: number }[] = [];
            let prevRight = 0;
            for (const org of orgsWithPlacement) {
                // +1 is to avoid tiny gaps due to rounding errors
                if (org.left > prevRight + 1) {
                    emptySpaces.push({ start: prevRight, end: org.left });
                }
                prevRight = org.right;
            }
            if (prevRight < realAvailableSpace) {
                emptySpaces.push({ start: prevRight, end: realAvailableSpace });
            }
            treeLevel.emptySpaces = emptySpaces;
        } else if (treeLevel.orientation === "vertical") {
            if (!skipVerticalLevels) {
                const parentGroups = new Map<number, ConnectedOrg[]>();
                for (const org of treeLevel.orgs) {
                    if (org.parent) {
                        const pid = org.parent.id;
                        if (!parentGroups.has(pid)) parentGroups.set(pid, []);
                        parentGroups.get(pid)!.push(org);
                    }
                }
                for (const org of treeLevel.orgs) {
                    if (parentGroups.size > 1) {
                        const parentPlacement = placements.get(
                            org!.parent!.id,
                        )!;
                        applyVerticalLeft(
                            [org],
                            parentPlacement.left! + config.verticalChildOffset,
                        );
                    } else {
                        applyVerticalLeft(
                            [org],
                            config.availableSpace / 2 -
                                (placements.get(org.id)?.width || 0) / 2,
                        );
                    }
                }

                // For vertical levels, emptySpaces is always [{ start: 0, end: config.availableSpace }]
                treeLevel.emptySpaces = [
                    { start: 0, end: config.availableSpace },
                ];

                // skip all levels until we find a horizontal level
                skipVerticalLevels = true;
            }
        }
    }
    return placements;
}

/**
 * Calculate the lines between organizations in the chart.
 *
 * This should be run after calculateHorizontalPositions.
 */
export function calculateLinesBetweenOrgs(
    levelsMap: TreeLevelMap,
    placements: Map<number, OrgPlacement>,
    config: OrgChartConfig,
) {
    if (!levelsMap.root) return [];
    const lines: OrgLine[] = [];
    function traverse(org: ConnectedOrg) {
        const orgLines = calculateLinesForOrg(
            levelsMap,
            org,
            placements,
            config,
        );
        lines.push(...orgLines);
        if (org.children && org.children.length > 0) {
            for (const child of org.children) {
                traverse(child);
            }
        }
    }
    traverse(levelsMap.root);
    return lines;
}

/**
 * Calculate the lines connecting an org to its children.
 */
function calculateLinesForOrg(
    levelsMap: TreeLevelMap,
    org: ConnectedOrg,
    placements: Map<number, OrgPlacement>,
    config: OrgChartConfig,
) {
    const lines: OrgLine[] = [];
    const placement = placements.get(org.id);
    if (!placement) {
        return lines;
    }
    if (org.children && org.children.length > 0) {
        // Determine if org is in a vertical level, their lines are different
        const orgLevelObj = levelsMap.get(org.level ?? 0);
        const isVerticalLevel = orgLevelObj?.orientation === "vertical";
        const orgIsFirstInLevel = orgLevelObj?.orgs[0] === org;
        const orgIsLastInLevel =
            orgLevelObj?.orgs[orgLevelObj.orgs.length - 1] === org;

        for (const child of org.children) {
            const childPlacement = placements.get(child.id);
            const isChildVerticalLevel =
                levelsMap.get(child.level ?? 0)?.orientation === "vertical";
            if (childPlacement) {
                const line: OrgLine = { points: [] };
                // If the child is on the same level as its parent, the line is horizontal
                if (child.level === org.level) {
                    // Draw a horizontal line from parent's center to child's center
                    line.points.push({
                        x: (placement.left || 0) + placement.width / 2,
                        y: placement.top + placement.height / 2,
                    });
                    line.points.push({
                        x:
                            (childPlacement.left || 0) +
                            childPlacement.width / 2,
                        y: childPlacement.top + childPlacement.height / 2,
                    });
                } else if (org.lineSkipsLevels && org.lineSkipsLevels > 0) {
                    // Start the line half of skipLineExtraSpacing from the edge of parent
                    let startX: number;

                    const level = levelsMap.get(org.level + 1)!;
                    // If the line skips levels, but it's not skipping at the edges,
                    // we want to start the line from the closest gap to the center of the org
                    if (!level?.leftSkipLine && !level?.rightSkipLine) {
                        // Find the closest gap to the center of the org
                        const emptySpaces = level.emptySpaces || [];
                        const centerX =
                            (placement.left || 0) + placement.width / 2;
                        let closestGap: { start: number; end: number } | null =
                            null;
                        let closestDistance = Infinity;
                        for (const gap of emptySpaces) {
                            const gapCenter = (gap.start + gap.end) / 2;
                            const distance = Math.abs(gapCenter - centerX);
                            if (distance < closestDistance) {
                                closestDistance = distance;
                                closestGap = gap;
                            }
                        }
                        if (closestGap) {
                            startX = (closestGap.start + closestGap.end) / 2;
                        } else {
                            startX = centerX; // fallback
                        }
                    } else if (orgIsLastInLevel) {
                        // Start from the right edge of the org
                        startX =
                            (placement.left || 0) +
                            placement.width -
                            config.skipLineExtraSpacing / 2;
                    } else if (orgIsFirstInLevel) {
                        // Start from the left edge of the org
                        startX =
                            (placement.left || 0) +
                            config.skipLineExtraSpacing / 2;
                    } else {
                        // Fallback to center
                        startX =
                            (placement.left || 0) + placement.width / 2;
                    }

                    line.points.push({
                        x: startX,
                        y: placement.top + placement.height / 2,
                    });
                    // Vertical line down to the level gap above the child
                    
                    // Vertical line down to the level gap above the child
                    const isChildVerticalLevel =
                        levelsMap.get(child.level ?? 0)?.orientation ===
                        "vertical";
                    const spacing = isChildVerticalLevel ? config.verticalSubtreeSpacing / 2 : config.verticalSpacing / 2;
                    const midY =
                        childPlacement.top - spacing;
                    line.points.push({
                        x: startX,
                        y: midY,
                    });
                    // Horizontal line to child's center
                    line.points.push({
                        x:
                            (childPlacement.left || 0) +
                            childPlacement.width / 2,
                        y: midY,
                    });
                    // Vertical line down to top of child
                    line.points.push({
                        x:
                            (childPlacement.left || 0) +
                            childPlacement.width / 2,
                        y: childPlacement.top,
                    });
                }
                // If the child is in a vertical level, the line goes down on the side
                else if (isChildVerticalLevel) {
                    // Start point: half of verticalChildOffset from the left of parent
                    const startX =
                        (placement.left || 0) + config.verticalChildOffset / 2;
                    const midY = childPlacement.top + childPlacement.height / 2;
                    // Go down to the middle of the child
                    line.points.push({
                        x: startX,
                        y: placement.top + placement.height,
                    });
                    line.points.push({
                        x: startX,
                        y: midY,
                    });
                    // Go right to connect to the child
                    line.points.push({
                        x:
                            (childPlacement.left || 0) +
                            childPlacement.width / 2,
                        y: midY,
                    });
                }
                // Otherwise the parent is in a horizontal level
                else {
                    // Start point: bottom center of parent
                    line.points.push({
                        x: (placement.left || 0) + placement.width / 2,
                        y: placement.top + placement.height,
                    });
                    // Vertical line down to the level gap above the child
                    const isChildVerticalLevel =
                        levelsMap.get(child.level ?? 0)?.orientation ===
                        "vertical";
                    const spacing = isChildVerticalLevel ? config.verticalSubtreeSpacing / 2 : config.verticalSpacing / 2;
                    const midY = childPlacement.top - spacing;
                    line.points.push({
                        x: (placement.left || 0) + placement.width / 2,
                        y: midY,
                    });
                    // Horizontal line to child's center
                    line.points.push({
                        x:
                            (childPlacement.left || 0) +
                            childPlacement.width / 2,
                        y: midY,
                    });
                    // Vertical line down to top of child
                    line.points.push({
                        x:
                            (childPlacement.left || 0) +
                            childPlacement.width / 2,
                        y: childPlacement.top,
                    });
                }
                lines.push(line);
            }
        }
    }

    return lines;
}
