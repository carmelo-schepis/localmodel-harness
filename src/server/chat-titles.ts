export type TitleModel = { name: string; size?: number; capabilities: string[] };

export function chooseTitleModel(installed: TitleModel[], loadedNames: Set<string>): TitleModel | undefined {
  return installed
    .filter(model => loadedNames.has(model.name) && model.capabilities.includes('completion'))
    .sort((a, b) => {
      const aSize=Number.isFinite(a.size)&&a.size!>0?a.size:undefined,bSize=Number.isFinite(b.size)&&b.size!>0?b.size:undefined;
      if(aSize!==undefined&&bSize!==undefined&&aSize!==bSize)return aSize-bSize;
      if(aSize!==undefined&&bSize===undefined)return -1;
      if(aSize===undefined&&bSize!==undefined)return 1;
      return a.name.localeCompare(b.name);
    })[0];
}

export function cleanTitle(value: string): string | undefined {
  const title = value.trim().replace(/^title\s*:\s*/i, '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').replace(/^['"“”]+|['"“”]+$/g, '').trim();
  if (!title || title.length > 60 || /[<>]/.test(title)) return undefined;
  return title;
}

export function titleExcerpt(content: string): string {
  return content.split(/\n\n(?:Attached source material|\[Attached image:|\[Reused image from earlier turn)/i)[0].slice(0, 2000);
}

export function isGenericProjectName(name: string): boolean {
  return /^(?:new project|my research|chat(?:\s+\d+)?|project\s+\d+)$/i.test(name.trim());
}
