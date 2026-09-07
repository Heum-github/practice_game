import type { Inventory } from '../gameplay/Inventory';
import { itemDef } from '../gameplay/Items';
import { RECIPES, craftBlocker, type CraftContext, type Recipe } from '../gameplay/Recipes';

/**
 * 제작창 (`C`).
 *
 * 레시피가 셋뿐이라 목록을 접지 않고 전부 펼쳐둔다.
 * 재료가 모자라면 부족한 만큼을 그 자리에 보여준다 — 무엇을 더 캐야 하는지가 곧 목표가 된다.
 */
export class CraftPanel {
  private readonly root: HTMLDivElement;
  private readonly rows: Array<{ el: HTMLDivElement; recipe: Recipe; cost: HTMLDivElement }> = [];

  private open = false;

  constructor(
    container: HTMLElement,
    private readonly inventory: Inventory,
    private readonly onCraft: (recipe: Recipe) => void,
    private readonly context: () => CraftContext,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'craft craft--hidden';

    const box = document.createElement('div');
    box.className = 'craft__box';

    const title = document.createElement('div');
    title.className = 'craft__title';
    title.textContent = '제작';
    box.appendChild(title);

    for (const recipe of RECIPES) {
      const def = itemDef(recipe.output);

      const row = document.createElement('div');
      row.className = 'craft__row';

      const glyph = document.createElement('span');
      glyph.className = 'craft__glyph';
      glyph.textContent = def.glyph;
      glyph.style.color = def.color;

      const body = document.createElement('div');
      body.className = 'craft__body';

      const name = document.createElement('div');
      name.className = 'craft__name';
      name.textContent = def.name;

      const note = document.createElement('div');
      note.className = 'craft__note';
      note.textContent = recipe.cookTime
        ? `${recipe.note} · 불 앞을 지켜야 한다`
        : recipe.note;

      const cost = document.createElement('div');
      cost.className = 'craft__cost';

      body.append(name, note, cost);

      const button = document.createElement('button');
      button.className = 'craft__btn';
      // 시간이 드는 것은 단추부터 다르게 말한다 — 누르고 나서 알면 늦다
      button.textContent = recipe.cookTime ? `조리 ${recipe.cookTime}초` : '제작';
      button.onclick = (): void => this.onCraft(recipe);

      row.append(glyph, body, button);
      box.appendChild(row);

      this.rows.push({ el: row, recipe, cost });
    }

    const hint = document.createElement('div');
    hint.className = 'craft__hint';
    hint.textContent = 'C — 닫기';
    box.appendChild(hint);

    this.root.appendChild(box);
    container.appendChild(this.root);

    inventory.onChange(() => {
      if (this.open) this.refresh();
    });
  }

  private refresh(): void {
    const ctx = this.context();
    for (const row of this.rows) {
      const blocker = craftBlocker(row.recipe, this.inventory, ctx);
      row.el.classList.toggle('craft__row--locked', blocker !== null);

      // 재료가 아니라 조건이 막고 있으면 그것부터 알려준다
      if (blocker && blocker !== '재료가 부족하다') {
        row.cost.innerHTML = `<span style="color:#d98a4a">${blocker}</span>`;
        continue;
      }

      row.cost.innerHTML = row.recipe.inputs
        .map((i) => {
          const def = itemDef(i.id);
          const have = this.inventory.countOf(i.id);
          const enough = have >= i.count;
          const color = enough ? '#b9c46a' : '#d98a4a';
          return `<span style="color:${color}">${def.name} ${have}/${i.count}</span>`;
        })
        .join('　');
    }
  }

  toggle(): void {
    this.open = !this.open;
    this.root.classList.toggle('craft--hidden', !this.open);
    if (this.open) this.refresh();
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.root.classList.add('craft--hidden');
  }

  get isOpen(): boolean {
    return this.open;
  }

  dispose(): void {
    this.root.remove();
  }
}
