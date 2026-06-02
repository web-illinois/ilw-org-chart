import { expect, test } from "@playwright/test";
import { axeTestFunction } from "@illinois-toolkit/ilw-core";

test.describe("homepage", () => {
    test("should not have any automatically detectable accessibility issues", async ({page}, testInfo) => {
        const result = await axeTestFunction(page, testInfo, "./samples/index.html");

        expect(result).toBeTruthy();
    });
});