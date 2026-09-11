import assert from 'node:assert/strict';
import { test } from 'node:test';
import { performance } from 'node:perf_hooks';
import { ConnectorSchemaError, inspectConnectorSchema, validateConnectorArguments as validate } from '../server/connector-schema-validation';
const code = (expected: ConnectorSchemaError['code']) => (error: unknown) => error instanceof ConnectorSchemaError && error.code === expected;
const invalid = (schema: unknown, args: unknown) => assert.throws(() => validate(schema,args),code('invalid_tool_arguments'));
const unsupported = (schema: unknown, args: unknown = null) => assert.throws(() => validate(schema,args),code('unsupported_schema'));

test('common object tool schemas enforce properties, required values and additional properties', () => {
  const schema = { type: 'object', properties: { title: { type: 'string', minLength: 1 }, count: { type: 'integer', minimum: 0 }, enabled: { type: 'boolean' } }, required: ['title'], additionalProperties: false };
  validate(schema,{title:'Report',count:2,enabled:false}); invalid(schema,{}); invalid(schema,{title:''}); invalid(schema,{title:'x',count:1.2}); invalid(schema,{title:'x',surprise:1});
  validate({ properties: { optional: false } },{}); invalid({properties:{optional:false}},{optional:0});
});

test('boolean, const, enum and primitive types have exact JSON equality semantics', () => {
  validate(true,null); invalid(false,null); validate({const:{a:1,b:[2]}},{b:[2],a:1}); invalid({const:{a:1}},{a:'1'});
  validate({enum:[null,{a:1},[1,2]]},{a:1}); invalid({enum:[[1,2]]},[2,1]);
  for(const value of [1,1.5]) validate({type:'number'},value);
  validate({type:['string','null']},null); invalid({type:'object'},[]); invalid({type:'integer'},1.1);
});

test('numeric comparisons and decimal multipleOf avoid floating-point tolerances', () => {
  validate({minimum:0,exclusiveMaximum:2,multipleOf:0.1},0.3);
  invalid({multipleOf:0.1},0.30000000000000004); invalid({multipleOf:2},3); validate({multipleOf:0.01},-0.03);
  validate({multipleOf:1e-7},2e-7); invalid({exclusiveMinimum:0},0); invalid({maximum:2},3);
});

test('array prefix items, contains, uniqueness and object dependencies compose correctly', () => {
  const schema = {type:'array',prefixItems:[{type:'string'}],items:{type:'integer'},minItems:2,maxItems:4,contains:{const:2},minContains:1,maxContains:1,uniqueItems:true};
  validate(schema,['x',1,2]); invalid(schema,['x',1]); invalid(schema,['x',2,2]); invalid(schema,['x','y',2]);
  invalid({uniqueItems:true},[{a:1,b:2},{b:2,a:1}]); validate({prefixItems:[true],items:false},[1]); invalid({prefixItems:[true],items:false},[1,2]);
  const dependent = {dependentRequired:{credit:['billing']},dependentSchemas:{credit:{properties:{billing:{type:'string'}}}},propertyNames:{pattern:'^[a-z]+$'},minProperties:1,maxProperties:3};
  validate(dependent,{credit:1,billing:'address'}); invalid(dependent,{credit:1}); invalid(dependent,{credit:1,billing:0}); invalid(dependent,{'BAD':1});
});

test('logical applicators and local pointer references preserve 2020-12 sibling constraints', () => {
  const schema = {$schema:'https://json-schema.org/draft/2020-12/schema',$defs:{'a/b~c':{type:'integer'}},$ref:'#/$defs/a~1b~0c',minimum:2};
  validate(schema,3); invalid(schema,1); invalid(schema,'3');
  validate({anyOf:[{type:'string'},{type:'number'}]},0); invalid({oneOf:[{type:'number'},{type:'integer'}]},1);
  invalid({allOf:[{type:'number'},{minimum:5}]},2); invalid({not:{const:1}},1);
  validate({if:{type:'number'},then:{minimum:3},else:{type:'string'}},'ok'); invalid({if:{type:'number'},then:{minimum:3}},2);
  validate({$defs:{'a b':{const:1}},$ref:'#/$defs/a%20b'},1);
});

test('unsupported dialects, keywords and references fail even inside an unvisited branch', () => {
  for(const schema of [{$schema:'http://json-schema.org/draft-07/schema#'},{$dynamicRef:'#/$defs/x',$defs:{x:{type:'integer'}}},{$ref:'https://schema.example/x'},{$ref:'#missing'},{$ref:'#/$defs/missing'},{$id:'https://schema.example'}, {unevaluatedProperties:false},{format:'email'},{anyOf:[true,{unknownConstraint:1}]}]) unsupported(schema);
  for(const schema of [{type:'nonsense'},{type:[]},{required:[1]},{multipleOf:0},{items:[]},{allOf:[]},{minLength:-1},{pattern:3}]) unsupported(schema);
  validate({title:'Example',description:'Annotation',default:'x',examples:['x'],deprecated:false,readOnly:true,writeOnly:false,$comment:'No effect'},123);
});

test('safe patterns agree with ECMAScript unicode semantics for the supported grammar', () => {
  const patterns = ['', '^$', 'abc', '^abc$', '^[A-Za-z0-9_-]+$', '^a{2,4}b?$', '[^a-c]*z', '^\\d+\\s\\w+$', '^.$', '^\\S*$', '^a.*z$', '[^]', '[]', 'a{0}', 'a{0,2}', '^a+b+c+$'];
  const values = ['', 'abc', 'xabcx', 'aab','aaaab','aaaaab','a z','12 hello','a\nb','\n','\r','\u2028','\ufeff','😀','abcz','z','aaabbbccc','zz','---'];
  for(const pattern of patterns) for(const value of values) {
    const expected = new RegExp(pattern,'u').test(value);
    if(expected) validate({pattern},value); else invalid({pattern},value);
  }
  validate({patternProperties:{'^x_':{type:'integer'}},additionalProperties:false},{x_count:3});
  invalid({patternProperties:{'^x_':{type:'integer'}},additionalProperties:false},{other:3});
  validate({minLength:1,maxLength:1},'😀'); invalid({maxLength:1},'😀😀');
});

test('dangerous regex features are rejected and allowed ambiguous repetition consumes bounded work', () => {
  const start=performance.now();
  for(const pattern of ['^(a+)+$','(a|aa)*','(?=a)','(.)\\1','\\p{Letter}+','[z-a]','a{999}','a+?']) unsupported({pattern},'a'.repeat(28)+'!');
  assert.throws(()=>validate({pattern:'a*a*a*a*a*a*a*a*a*a*b'},'a'.repeat(20000)),code('schema_budget_exceeded'));
  assert.ok(performance.now()-start<1000,'validation should finish without blocking for seconds');
});

test('exponentially expanded references and non-progressing cycles fail within a global budget', () => {
  const defs: Record<string,unknown> = {s0:{type:'number'}};
  for(let i=1;i<=24;i++) defs[`s${i}`]={allOf:[{$ref:`#/$defs/s${i-1}`},{$ref:`#/$defs/s${i-1}`}]};
  const start=performance.now(); assert.throws(()=>validate({$defs:defs,$ref:'#/$defs/s24'},0),code('schema_budget_exceeded'));
  unsupported({$ref:'#'},0); assert.ok(performance.now()-start<1000);
  const recursive={$defs:{node:{type:'object',properties:{value:{type:'integer'},next:{$ref:'#/$defs/node'}},required:['value'],additionalProperties:false}},$ref:'#/$defs/node'};
  validate(recursive,{value:1,next:{value:2}}); invalid(recursive,{value:1,next:{value:'wrong'}});
});

test('structural limits and caller budgets cannot disable bounding', () => {
  assert.throws(()=>validate({type:'string'},'x'.repeat(65537)),code('invalid_tool_arguments'));
  unsupported({description:'x'.repeat(65537)});
  assert.throws(()=>validate({type:'string'},'some text',{maxSteps:1}),code('schema_budget_exceeded'));
});


test('catalog preflight reports unsupported schemas without needing sample arguments', () => {
  inspectConnectorSchema({type:'object',required:['name'],properties:{name:{type:'string'}}});
  for(const schema of [{$dynamicRef:'#'},{$ref:'#'},{pattern:'^(a+)+$'},{format:'uri'},{pattern:'\\-'}]) assert.throws(()=>inspectConnectorSchema(schema),code('unsupported_schema'));
  assert.equal(validate({type:'string'},'valid'),true);
});

test('repeated wide-object and long-string comparisons consume the work budget promptly', async () => {
  const { spawnSync } = await import('node:child_process');
  const moduleUrl = new URL('../server/connector-schema-validation.ts', import.meta.url).href;
  const script = `
    import assert from 'node:assert/strict';
    import { validateConnectorArguments as validate } from ${JSON.stringify(moduleUrl)};
    const object = Object.fromEntries(Array.from({ length: 6000 }, (_, i) => ['k' + i, 0]));
    const text = 'x'.repeat(58000);
    const cases = [
      [{ const: { ...object, k0: 1 } }, object],
      [{ maxProperties: 0 }, object],
      [{ const: text + 'a' }, text + 'b'],
    ];
    const durations = [];
    for (const [leaf, value] of cases) {
      const definitions = { s0: leaf };
      for (let i = 1; i <= 24; i++) definitions['s' + i] = {
        anyOf: [{ $ref: '#/$defs/s' + (i - 1) }, { $ref: '#/$defs/s' + (i - 1) }],
      };
      const schema = { $defs: definitions, $ref: '#/$defs/s24' };
      assert.ok(Buffer.byteLength(JSON.stringify(schema)) <= 65536);
      assert.ok(Buffer.byteLength(JSON.stringify(value)) <= 65536);
      const started = performance.now();
      assert.throws(() => validate(schema, value), error => error.code === 'schema_budget_exceeded');
      durations.push(performance.now() - started);
    }
    console.log(JSON.stringify(durations));
  `;
  // A subprocess timeout also contains a future regression that blocks the event loop.
  const child = spawnSync(process.execPath, ['--import', import.meta.resolve('tsx'), '--input-type=module'], {
    input: script, encoding: 'utf8', timeout: 5000, maxBuffer: 65536,
  });
  assert.equal(child.error, undefined, `Validator subprocess failed: ${child.error?.message}`);
  assert.equal(child.status, 0, child.stderr);
  const durations = JSON.parse(child.stdout) as number[];
  assert.equal(durations.length, 3);
  for (const duration of durations) assert.ok(duration < 2000, `Bounded validation took ${duration} ms`);
});
