class TrieNode {
  children: Map<string, TrieNode> = new Map()
  // The original-cased word ending at this node, if any — matching walks the
  // trie lowercased, but suggestions should still show real casing.
  word: string | null = null
}

export class Trie {
  private root = new TrieNode()

  insert(word: string): void {
    let node = this.root
    for (const ch of word.toLowerCase()) {
      let next = node.children.get(ch)
      if (!next) {
        next = new TrieNode()
        node.children.set(ch, next)
      }
      node = next
    }
    node.word = word
  }

  // All inserted words whose lowercased form starts with `prefix`, alphabetical.
  search(prefix: string): string[] {
    let node = this.root
    for (const ch of prefix.toLowerCase()) {
      const next = node.children.get(ch)
      if (!next) return []
      node = next
    }
    const results: string[] = []
    collect(node, results)
    return results.sort((a, b) => a.localeCompare(b))
  }
}

function collect(node: TrieNode, out: string[]): void {
  if (node.word) out.push(node.word)
  for (const child of node.children.values()) collect(child, out)
}
