import { randomUUID } from "node:crypto";

export function createTargetCompanies({ getConfig, putConfig }) {
  function getList() {
    const data = getConfig("targetWishlist");
    return Array.isArray(data?.companies) ? data.companies : [];
  }

  function saveList(companies) {
    putConfig("targetWishlist", {
      companies,
      updatedAt: new Date().toISOString(),
    });
  }

  function list() {
    return getList();
  }

  function create(body) {
    const name = String(body.name ?? "").trim();
    if (!name) {
      const err = new Error("Company name is required.");
      err.status = 400;
      throw err;
    }

    const company = {
      id: randomUUID(),
      name: name.slice(0, 200),
      targetRoles: String(body.targetRoles ?? "").trim().slice(0, 500),
      tier: ["dream", "target", "safety"].includes(body.tier) ? body.tier : "target",
      status: ["researching", "watching", "reached-out", "interviewing"].includes(body.status) ? body.status : "watching",
      careersUrl: String(body.careersUrl ?? "").trim().slice(0, 2000),
      notes: String(body.notes ?? "").trim().slice(0, 10000),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const companies = getList();
    companies.push(company);
    saveList(companies);
    return company;
  }

  function update(id, body) {
    const companies = getList();
    const index = companies.findIndex((c) => c.id === id);
    if (index === -1) {
      const err = new Error("Target company not found.");
      err.status = 404;
      throw err;
    }

    const current = companies[index];
    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (!name) {
        const err = new Error("Company name is required.");
        err.status = 400;
        throw err;
      }
      current.name = name.slice(0, 200);
    }
    if (body.targetRoles !== undefined) {
      current.targetRoles = String(body.targetRoles).trim().slice(0, 500);
    }
    if (body.tier !== undefined && ["dream", "target", "safety"].includes(body.tier)) {
      current.tier = body.tier;
    }
    if (body.status !== undefined && ["researching", "watching", "reached-out", "interviewing"].includes(body.status)) {
      current.status = body.status;
    }
    if (body.careersUrl !== undefined) {
      current.careersUrl = String(body.careersUrl).trim().slice(0, 2000);
    }
    if (body.notes !== undefined) {
      current.notes = String(body.notes).trim().slice(0, 10000);
    }
    current.updatedAt = new Date().toISOString();

    companies[index] = current;
    saveList(companies);
    return current;
  }

  function remove(id) {
    const companies = getList();
    const filtered = companies.filter((c) => c.id !== id);
    if (filtered.length === companies.length) {
      const err = new Error("Target company not found.");
      err.status = 404;
      throw err;
    }
    saveList(filtered);
    return { deleted: true, id };
  }

  return { list, create, update, remove };
}
