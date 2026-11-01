// Show the plugin UI (232px width, 360px height)
figma.showUI(__html__, { width: 232, height: 360, themeColors: true });

// Track chronological selection order (to identify 1st selected, 2nd selected, etc.)
let selectionHistory = [];

function updateSelectionHistory() {
  const selection = figma.currentPage.selection;
  const currentIds = new Set(selection.map(n => n.id));

  // Retain existing IDs that are still in current selection
  selectionHistory = selectionHistory.filter(id => currentIds.has(id));

  // Append newly selected IDs
  const historySet = new Set(selectionHistory);
  for (const node of selection) {
    if (!historySet.has(node.id)) {
      selectionHistory.push(node.id);
      historySet.add(node.id);
    }
  }
}

// Filter selection to find top-level selected nodes only (to prevent nested double-shifting)
function getTopLevelSelection() {
  const selection = figma.currentPage.selection;
  const ids = new Set(selection.map(n => n.id));
  return selection.filter(node => {
    let parent = node.parent;
    while (parent) {
      if (ids.has(parent.id)) {
        return false; // Skip nested child because its parent is also selected
      }
      parent = parent.parent;
    }
    return true;
  });
}

// Returns top-level nodes ordered by user's selection history
function getOrderedTopLevelSelection() {
  updateSelectionHistory();
  const topLevel = getTopLevelSelection();
  const topLevelMap = new Map(topLevel.map(node => [node.id, node]));

  const ordered = [];
  for (const id of selectionHistory) {
    const node = topLevelMap.get(id);
    if (node) {
      ordered.push(node);
      topLevelMap.delete(id);
    }
  }
  for (const node of topLevelMap.values()) {
    ordered.push(node);
  }
  return ordered;
}

// Send current selection state to the UI
function sendSelectionToUI() {
  const selection = figma.currentPage.selection;
  const orderedTopLevel = getOrderedTopLevelSelection();

  let targetName = null;
  let targetId = null;
  // Auto-align mode is active when 2 or more top-level frames are selected
  if (orderedTopLevel.length >= 2) {
    const targetNode = orderedTopLevel[orderedTopLevel.length - 1];
    targetName = targetNode.name || 'Target layer';
    targetId = targetNode.id;
  }

  figma.ui.postMessage({
    type: 'selection-changed',
    totalCount: selection.length,
    topLevelCount: orderedTopLevel.length,
    targetName: targetName,
    targetId: targetId
  });
}

// Monitor canvas selection changes
figma.on('selectionchange', sendSelectionToUI);

// Handle messages from the UI
figma.ui.onmessage = msg => {
  if (msg.type === 'ui-ready') {
    sendSelectionToUI();
  }

  if (msg.type === 'swap-target') {
    const ordered = getOrderedTopLevelSelection();
    if (ordered.length >= 2) {
      // Rotate the target: take the last item and place it at the front so previous item becomes the new target
      const last = ordered[ordered.length - 1];
      selectionHistory = selectionHistory.filter(id => id !== last.id);
      selectionHistory.unshift(last.id);

      sendSelectionToUI();
      const updated = getOrderedTopLevelSelection();
      const newTarget = updated[updated.length - 1];
      figma.notify(`🎯 Target changed to "${newTarget.name}"`);
    }
  }

  if (msg.type === 'move-nodes') {
    const { direction, customValue, gapValue } = msg.payload;
    const orderedNodes = getOrderedTopLevelSelection();

    if (orderedNodes.length === 0) {
      figma.notify('⚠️ Select at least one layer to move.');
      return;
    }

    const gap = typeof gapValue === 'number' && !isNaN(gapValue) ? gapValue : parseFloat(gapValue) || 0;

    // AUTO-ALIGN MODE: When 2 or more frames are selected
    // Align all non-target frames' edges with the target frame (last selected frame)
    if (orderedNodes.length >= 2) {
      const targetNode = orderedNodes[orderedNodes.length - 1];

      if (typeof targetNode.x !== 'number' || typeof targetNode.y !== 'number' ||
          typeof targetNode.width !== 'number' || typeof targetNode.height !== 'number') {
        figma.notify('⚠️ Target layer does not have valid coordinates.');
        return;
      }

      const nonTargetNodes = orderedNodes.slice(0, orderedNodes.length - 1);

      const getAbs = (node) => {
        try {
          if (node.absoluteTransform) {
            return {
              x: node.absoluteTransform[0][2],
              y: node.absoluteTransform[1][2]
            };
          }
        } catch (e) {}
        return { x: node.x, y: node.y };
      };

      const targetAbs = getAbs(targetNode);
      let movedCount = 0;

      for (let i = 0; i < nonTargetNodes.length; i++) {
        const node = nonTargetNodes[i];
        if (node.locked) continue;
        if (typeof node.x !== 'number' || typeof node.y !== 'number' ||
            typeof node.width !== 'number' || typeof node.height !== 'number') {
          continue;
        }

        const isSameParent = node.parent === targetNode.parent;
        const nodeAbs = getAbs(node);

        try {
          if (direction === 'left') {
            // Align left edges: node.x aligns to targetNode.x + gap
            if (isSameParent) {
              node.x = targetNode.x + gap;
            } else {
              const desiredAbsX = targetAbs.x + gap;
              node.x += (desiredAbsX - nodeAbs.x);
            }
          } else if (direction === 'right') {
            // Align right edges: node right edge aligns to target right edge - gap
            if (isSameParent) {
              node.x = targetNode.x + targetNode.width - node.width - gap;
            } else {
              const desiredAbsX = targetAbs.x + targetNode.width - node.width - gap;
              node.x += (desiredAbsX - nodeAbs.x);
            }
          } else if (direction === 'top') {
            // Align top edges: node.y aligns to targetNode.y + gap
            if (isSameParent) {
              node.y = targetNode.y + gap;
            } else {
              const desiredAbsY = targetAbs.y + gap;
              node.y += (desiredAbsY - nodeAbs.y);
            }
          } else if (direction === 'bottom') {
            // Align bottom edges: node bottom edge aligns to target bottom edge - gap
            if (isSameParent) {
              node.y = targetNode.y + targetNode.height - node.height - gap;
            } else {
              const desiredAbsY = targetAbs.y + targetNode.height - node.height - gap;
              node.y += (desiredAbsY - nodeAbs.y);
            }
          }
          movedCount++;
        } catch (err) {
          console.error('Error aligning node:', err);
        }
      }

      if (movedCount === 0) {
        figma.notify('⚠️ Selected layers are locked or could not be aligned.');
        return;
      }

      const dirCapitalized = direction.charAt(0).toUpperCase() + direction.slice(1);
      if (nonTargetNodes.length === 1) {
        figma.notify(`✨ ${dirCapitalized} aligned "${nonTargetNodes[0].name}" with "${targetNode.name}"`);
      } else {
        figma.notify(`✨ ${dirCapitalized} aligned ${movedCount} layers with "${targetNode.name}"`);
      }
      return;
    }

    // SINGLE-NODE MOVEMENT: 1 frame selected
    // Shift the selected top-level node by shift distance (customValue - gapValue)
    const val = typeof customValue === 'number' && !isNaN(customValue) ? customValue : parseFloat(customValue) || 100;
    const netDist = val - gap;

    let shiftX = 0;
    let shiftY = 0;

    if (direction === 'left') shiftX = -netDist;
    else if (direction === 'right') shiftX = netDist;
    else if (direction === 'top') shiftY = -netDist;
    else if (direction === 'bottom') shiftY = netDist;

    orderedNodes.forEach(node => {
      if (node.locked) return;
      if (typeof node.x !== 'number' || typeof node.y !== 'number' ||
        typeof node.width !== 'number' || typeof node.height !== 'number') {
        return;
      }
      try {
        node.x += shiftX;
        node.y += shiftY;
      } catch (err) {
        console.error('Error shifting node:', err);
      }
    });

    const layerWord = orderedNodes.length === 1 ? 'layer' : 'layers';
    figma.notify(`✨ Moved ${orderedNodes.length} ${layerWord} ${direction}`);
  }

  if (msg.type === 'resize') {
    figma.ui.resize(232, Math.round(msg.height));
  }

  if (msg.type === 'cancel') {
    figma.closePlugin();
  }
};