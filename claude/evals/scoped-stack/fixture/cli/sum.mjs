/** Sum a list of numbers. */
export function sum(list) {
  return list.reduce((total, value) => total + value, 0);
}
