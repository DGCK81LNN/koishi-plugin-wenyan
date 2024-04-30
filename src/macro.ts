// https://github.com/wenyan-lang/wenyan/blob/97f0a4b8c5a815467c5c2cac08215d722efde208/src/macro.ts#L140-L184

import type { MacroDefinition } from "@wenyan/core/types";

function calcBracketStarts(src: string) {
  const starts: number[] = [];
  let level = 0;
  for (var i = 0; i < src.length; i++) {
    let c = src[i];
    if (c == "「") {
      level++;
    } else if (c == "」") {
      level--;
    } else if (c == "『") {
      level += 2;
    } else if (c == "』") {
      level -= 2;
    }
    if (level > 0) starts.push(i);
  }
  return starts;
}

export function expandMacros(src: string, macros: MacroDefinition[]) {
  for (const [from, to] of macros) {
    let re = new RegExp(from);
    const expand = ntxt => {
      let starts = calcBracketStarts(ntxt);
      let idx = ntxt.search(re);
      if (idx == -1) {
        return ntxt;
      }
      if (starts.includes(idx)) {
        // console.log("refused to expand macro inside string")
        let nxtend = idx + 1;
        while (starts.includes(nxtend) && nxtend < starts.length) {
          nxtend++;
        }
        nxtend++;
        ntxt = ntxt.slice(0, nxtend) + expand(ntxt.slice(nxtend));
      } else {
        ntxt = expand(ntxt.replace(re, to));
      }
      return ntxt;
    };
    src = expand(src);
  }
  return src;
}
