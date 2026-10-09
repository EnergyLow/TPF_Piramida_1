const money = value => `${Number(value).toLocaleString('ru-RU')} ₽`;

export async function initMenu() {
  const grid = document.querySelector('#menu-grid');
  const tabs = [...document.querySelectorAll('.menu-tab')];
  const search = document.querySelector('#menu-search');
  const demoNote = document.querySelector('#menu-demo-note');
  if (!grid) return;

  let items = [];
  let activeCategory = 'all';
  let query = '';

  try {
    const response = await fetch('./data/menu.json');
    if (!response.ok) throw new Error('Menu data unavailable');
    const data = await response.json();
    items = Array.isArray(data.items) ? data.items : [];
    if (data.demo === true && demoNote) demoNote.hidden = false;
  } catch {
    grid.innerHTML = '<p class="menu-empty">Меню пока не загрузилось. Позвоните нам, чтобы уточнить доступные позиции.</p>';
    return;
  }

  function render() {
    const filtered = items.filter(item => {
      const categoryMatch = activeCategory === 'all' || item.category === activeCategory;
      const haystack = `${item.name} ${item.description} ${item.categoryLabel}`.toLocaleLowerCase('ru');
      return categoryMatch && haystack.includes(query.toLocaleLowerCase('ru'));
    });
    grid.replaceChildren();
    if (!filtered.length) {
      const empty = document.createElement('p');
      empty.className = 'menu-empty';
      empty.textContent = 'По вашему запросу ничего не найдено. Попробуйте изменить поиск.';
      grid.append(empty);
      return;
    }
    filtered.forEach(item => {
      const card = document.createElement('article');
      card.className = 'menu-card';
      const imageWrap = document.createElement('div');
      imageWrap.className = 'menu-card-image';
      const image = document.createElement('img');
      image.src = item.image;
      image.alt = item.imageAlt || item.name;
      image.loading = 'lazy';
      image.width = 640;
      image.height = 560;
      imageWrap.append(image);
      if (item.badge) {
        const badge = document.createElement('span');
        badge.className = 'menu-badge';
        badge.textContent = item.badge;
        imageWrap.append(badge);
      }
      const body = document.createElement('div');
      body.className = 'menu-card-body';
      const row = document.createElement('div');
      row.className = 'menu-card-title-row';
      const title = document.createElement('h3');
      title.textContent = item.name;
      const price = document.createElement('span');
      price.className = 'price';
      price.textContent = item.price == null ? 'Уточнить' : money(item.price);
      row.append(title, price);
      const description = document.createElement('p');
      description.textContent = item.description;
      body.append(row, description);
      card.append(imageWrap, body);
      grid.append(card);
    });
  }

  tabs.forEach(tab => tab.addEventListener('click', () => {
    activeCategory = tab.dataset.category || 'all';
    tabs.forEach(button => {
      const selected = button === tab;
      button.classList.toggle('is-active', selected);
      button.setAttribute('aria-selected', String(selected));
    });
    render();
  }));
  search?.addEventListener('input', () => {
    query = search.value.trim();
    render();
  });
  render();
}
