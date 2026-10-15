// The @nestjs/swagger CLI plugin as a ts-jest AST transformer, so the e2e build reads the DTO
// classes the same way `nest build` does (nest-cli.json) and the OpenAPI document has bodies.
const transformer = require('@nestjs/swagger/plugin');

module.exports.name = 'nestjs-swagger-transformer';
// Bump when the options change, so ts-jest's cache is invalidated.
module.exports.version = 1;
module.exports.factory = (cs) =>
  transformer.before({ classValidatorShim: true, introspectComments: true }, cs.program);
