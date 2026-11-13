/**
 * Navigation mock that records the last page reference, so tests can assert
 * where a component tried to go (same approach as Salesforce's lwc-recipes).
 */
export const CurrentPageReference = jest.fn();

let lastPageReference;
let lastReplace;

const Navigate = Symbol('Navigate');
const GenerateUrl = Symbol('GenerateUrl');

export const NavigationMixin = (Base) =>
  class extends Base {
    [Navigate](pageReference, replace) {
      lastPageReference = pageReference;
      lastReplace = replace;
    }

    [GenerateUrl](pageReference) {
      lastPageReference = pageReference;
      return Promise.resolve('https://www.example.com');
    }
  };
NavigationMixin.Navigate = Navigate;
NavigationMixin.GenerateUrl = GenerateUrl;

export const getNavigateCalledWith = () => ({
  pageReference: lastPageReference,
  replace: lastReplace
});
