export function shouldOpenSearchResults(query: string): boolean {
  return Boolean(query.trim())
}

export function searchExitState() {
  return { query: '', expanded: false, resultsOpen: false }
}

export function searchResultSelectionState() {
  return { expanded: false, resultsOpen: false }
}

export function searchCollapseState() {
  return { expanded: false, resultsOpen: false }
}
