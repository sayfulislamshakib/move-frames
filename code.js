// Show the plugin UI (232px width, 360px height)
figma.showUI(__html__, { width: 232, height: 360, themeColors: true });

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

// Send current selection state to the UI
function sendSelectionToUI() {
  const selection = figma.currentPage.selection;
  const topLevelNodes = getTopLevelSelection();

  figma.ui.postMessage({
    type: 'selection-changed',
    totalCount: selection.length,
    topLevelCount: topLevelNodes.length
  });
}

// Monitor canvas selection changes
figma.on('selectionchange', sendSelectionToUI);

// Handle messages from the UI
figma.ui.onmessage = msg => {
  if (msg.type === 'ui-ready') {
    sendSelectionToUI();
  }

  if (msg.type === 'move-nodes') {
    const { direction, customValue, gapValue } = msg.payload;
    const selectedNodes = getTopLevelSelection();

    if (selectedNodes.length === 0) {
      figma.notify('⚠️ Select at least one layer to move.');
      return;
    }

    selectedNodes.forEach(node => {
      // Basic validation of coordinate properties
      if (typeof node.x !== 'number' || typeof node.y !== 'number' ||
        typeof node.width !== 'number' || typeof node.height !== 'number') {
        return;
      }

      // Determine the net shift distance (subtracting gap)
      const netDist = customValue - (gapValue || 0);

      let shiftX = 0;
      let shiftY = 0;

      if (direction === 'left') shiftX = -netDist;
      else if (direction === 'right') shiftX = netDist;
      else if (direction === 'top') shiftY = -netDist;
      else if (direction === 'bottom') shiftY = netDist;

      // Shift node positions
      node.x += shiftX;
      node.y += shiftY;
    });

    const layerWord = selectedNodes.length === 1 ? 'layer' : 'layers';
    figma.notify(`✨ Moved ${selectedNodes.length} ${layerWord} ${direction}`);
  }

  if (msg.type === 'resize') {
    figma.ui.resize(232, Math.round(msg.height));
  }

  if (msg.type === 'cancel') {
    figma.closePlugin();
  }
};