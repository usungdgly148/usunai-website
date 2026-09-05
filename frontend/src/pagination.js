export const USER_PAGE_SIZE = 12;

export function paginate(items, page, pageSize = USER_PAGE_SIZE) {
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const start = (currentPage - 1) * pageSize;

  return {
    currentPage,
    total,
    totalPages,
    items: items.slice(start, start + pageSize),
  };
}
